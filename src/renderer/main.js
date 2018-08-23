import Vue from 'vue'
// import VueI18n from 'vue-i18n'
import ElementUI from 'element-ui'
import 'element-ui/lib/theme-default/index.css'
import axios from 'axios'

import App from './App'
import router from './router'
import store from './store'
// import locales from './lang'
// let en = require('./lang/en.js');
// let zh = require('./lang/zh-CN.js');

if (!process.env.IS_WEB) Vue.use(require('vue-electron'))
Vue.http = Vue.prototype.$http = axios
Vue.config.productionTip = false

// Vue.use(VueI18n);
Vue.use(ElementUI);
Vue.use({
  install (Vue, options) {
    //添加实例方法
    Vue.prototype.$ipc = global.ipcRenderer || {};
    Vue.prototype.$remoteApi = global.remoteApi;
  }
});

// console.log(global.setting)
// Vue.config.lang = 'en';

// Object.keys(locales).forEach((lang) => {
//   Vue.locale(lang, locales[lang]);
// });

// const messages = {
//   zh: require('./lang/zh-CN.js'),
//   en: require('./lang/en.js')
// }
// const i18n = new VueI18n({
//   locale: 'en', // 语言标识
//   messages
// })

/* eslint-disable no-new */
new Vue({
  components: {App},
  // i18n,
  router,
  store,
  template: '<App/>'
}).$mount('#app')
