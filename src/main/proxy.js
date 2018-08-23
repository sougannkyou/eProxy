'use strict';

const http = require('http'),
  https = require('https'),
  async = require('async'),
  color = require('colorful'),
  certMgr = require('../lib/certMgr'),
  Recorder = require('../lib/recorder'),
  logUtil = require('../lib/log'),
  util = require('../lib/util'),
  events = require('events'),
  ThrottleGroup = require('stream-throttle').ThrottleGroup;

const T_TYPE_HTTP = 'http',
  T_TYPE_HTTPS = 'https',
  DEFAULT_CONFIG_PORT = 8088,
  DEFAULT_TYPE = T_TYPE_HTTP;

const PROXY_STATUS_INIT = 'INIT';
const PROXY_STATUS_READY = 'READY';
const PROXY_STATUS_CLOSED = 'CLOSED';

/**
 *
 * @class ProxyServer
 * @extends {events.EventEmitter}
 */
class ProxyServer extends events.EventEmitter {

  /**
   * Creates an instance of ProxyServer.
   *
   * @param {object} config - configs
   * @param {number} config.port - port of the proxy server
   * @param {object} [config.rule=null] - rule module to use
   * @param {string} [config.type=http] - type of the proxy server, could be 'http' or 'https'
   * @param {strign} [config.hostname=localhost] - host name of the proxy server, required when this is an https proxy
   * @param {object} [config.webInterface] - config of the web interface
   * @param {boolean} [config.webInterface.enable=false] - if web interface is enabled
   * @param {number} [config.webInterface.webPort=8002] - http port of the web interface
   * @param {number} [config.webInterface.wsPort] - web socket port of the web interface
   * @param {number} [config.throttle] - speed limit in kb/s
   * @param {boolean} [config.forceProxyHttps=false] - if proxy all https requests
   * @param {boolean} [config.silent=false] - if keep the console silent
   * @param {boolean} [config.dangerouslyIgnoreUnauthorized=false] - if ignore unauthorized server response
   *
   * @memberOf ProxyServer
   */
  constructor(config) {
    super();
    config = config || {};

    this.status = PROXY_STATUS_INIT;
    this.proxyPort = config.port;
    this.proxyType = /https/i.test(config.type || DEFAULT_TYPE) ? T_TYPE_HTTPS : T_TYPE_HTTP;
    this.proxyHostName = config.hostname || 'localhost';
    this.proxyWebinterfaceConfig = config.webInterface;
    this.proxyConfigPort = config.webConfigPort || DEFAULT_CONFIG_PORT;    //TODO : port to ui config server

    if (config.forceProxyHttps && !certMgr.ifRootCAFileExists()) {
      throw new Error('root CA not found. can not intercept https'); // TODO : give a reference to user
    } else if (this.proxyType === T_TYPE_HTTPS && !config.hostname) {
      throw new Error('hostname is required in https proxy');
    } else if (!this.proxyPort) {
      throw new Error('proxy port is required');
    }

    // ??
    // currentRule.setInterceptFlag(true);
    // logUtil.printLog(color.blue("The WebSocket will not work properly in the https intercept mode :("), logUtil.T_TIP);

    this.httpProxyServer = null;
    this.requestHandler = null;

    // copy the rule to keep the original proxyRule independent
    this.proxyRule = config.rule || {};

    if (config.silent) {
      logUtil.setPrintStatus(false);
    }

    if (config.throttle) {
      logUtil.printLog('throttle :' + config.throttle + 'kb/s');
      const rate = parseInt(config.throttle, 10);
      if (rate < 1) {
        throw new Error('Invalid throttle rate value, should be positive integer');
      }
      global._throttle = new ThrottleGroup({ rate: 1024 * rate }); // rate - byte/sec
    }

    // init recorder
    this.recorder = new Recorder();
    global.recorder = this.recorder; // TODO 消灭这个global

    // init request handler
    const RequestHandler = util.freshRequire('./requestHandler');
    this.requestHandler = new RequestHandler({
      forceProxyHttps: !!config.forceProxyHttps,
      dangerouslyIgnoreUnauthorized: !!config.dangerouslyIgnoreUnauthorized
    }, this.proxyRule, this.recorder);
  }

  /**
   * start the proxy server
   *
   * @returns ProxyServer
   *
   * @memberOf ProxyServer
   */
  start() {
    const self = this;
    if (self.status !== PROXY_STATUS_INIT) {
      throw new Error('server status is not PROXY_STATUS_INIT, can not run start()');
    }
    async.series(
      [
        //creat proxy server
        function (callback) {
          if (self.proxyType === T_TYPE_HTTPS) {
            certMgr.getCertificate(self.proxyHostName, (err, keyContent, crtContent) => {
              if (err) {
                callback(err);
              } else {
                self.httpProxyServer = https.createServer({
                  key: keyContent,
                  cert: crtContent
                }, self.requestHandler.userRequestHandler);
                callback(null);
              }
            });
          } else {
            self.httpProxyServer = http.createServer(self.requestHandler.userRequestHandler);
            callback(null);
          }
        },

        //handle CONNECT request for https over http
        function (callback) {
          self.httpProxyServer.on('connect', self.requestHandler.connectReqHandler);
          callback(null);
        },

        //start proxy server
        function (callback) {
          self.httpProxyServer.listen(self.proxyPort);
          callback(null);
        },

        //start web socket service
        // function(callback){
        //     self.ws = new wsServer({ port : self.proxyWsPort }, self.recorder);
        //     callback(null);
        // },

        //set proxy rule
        // function(callback){
        //     if (self.interceptHttps) {
        //         self.proxyRule.setInterceptFlag(true);
        //     }
        //     callback(null);
        // },

        //start web interface
        function (callback) {
          if (self.proxyWebinterfaceConfig && self.proxyWebinterfaceConfig.enable) {
            const webInterface = require('../lib/webInterface');
            self.webServerInstance = new webInterface(self.proxyWebinterfaceConfig, self);
          }
          callback(null);
        },
      ],

      //final callback
      (err, result) => {
        if (!err) {
          const tipText = (self.proxyType === T_TYPE_HTTP ? 'Http' : 'Https') + ' proxy started on port ' + self.proxyPort;
          logUtil.printLog(color.green(tipText));

          if (self.webServerInstance) {
            const webTip = 'web interface started on port ' + self.webServerInstance.webPort;
            logUtil.printLog(color.green(webTip));
          }

          self.status = PROXY_STATUS_READY;
          self.emit('ready');
        } else {
          const tipText = 'err when start proxy server :(';
          logUtil.printLog(color.red(tipText), logUtil.T_ERR);
          logUtil.printLog(err, logUtil.T_ERR);
          self.emit('error', {
            error: err
          });
        }
      }
    );

    return self;
  }


  /**
   * close the proxy server
   *
   * @returns ProxyServer
   *
   * @memberOf ProxyServer
   */
  close() {
    // clear recorder cache
    this.recorder && this.recorder.clear();

    this.httpProxyServer && this.httpProxyServer.close();
    this.webServerInstance && this.webServerInstance.close();

    this.recorder = null;
    this.httpProxyServer = null;
    this.webServerInstance = null;

    this.status = PROXY_STATUS_CLOSED;
    logUtil.printLog('server closed ' + this.proxyHostName + ':' + this.proxyPort);

    return this
  }
}

module.exports.ProxyServer = ProxyServer;
module.exports.utils = {
  systemProxyMgr: require('./lib/systemProxyMgr'),
  certMgr,
};

