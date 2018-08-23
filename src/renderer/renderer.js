(function () {
    const electron = require('electron');
    const ipcRenderer = electron.ipcRenderer;
    const remote = electron.remote;
    const remoteApi = require('./main-api.js');
    const setting = require('./setting.json');

    //only explose these variable
    global.remoteApi = remoteApi;
    global.ipcRenderer = ipcRenderer;
    global.setting = setting;
})();
