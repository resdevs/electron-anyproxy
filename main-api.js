'use strict';
/**
 * proxy 的接口封装，用于主进程与渲染进程之间数据通信
 */
const util = require('./lib/util');
const ip = require('ip');
const packageInfo = require('./package.json');
const ProxyServer = require('./proxy.js').ProxyServer;
const path = require('path');
const fs = require('fs');
let ruleModule;
let mainProxy;

const ruleFile = __dirname + '/rules.json';
const ruleCustomPath = __dirname + '/rule_custom';
const ruleSamplePath = __dirname + '/rule_sample';
const certMgr = require('./proxy.js').utils.certMgr;
const exec = require('child_process').exec;

const MSG_HAD_OPEN_PROXY = '已开启代理';
const MSG_OPEN_PROXY_SUCCESS = '开启成功';
const MSG_OPEN_PROXY_ERROR = '开启失败';
const MSG_HASNOT_OPEN_PROXY = '未开启代理';
const MSG_CLOSE_PROXY_SUCCESS = '关闭成功';

function getRuleModule(id) {
    if (!id) return null;
    const pathname = './rule_custom';
    const filename = 'custom_' + id + '.js';
    const filepath = path.resolve(pathname, filename);
    if (fs.existsSync(filepath)) {
        return require(filepath);
    } else {
        return null;
    }
}

function createProxy(options) {
    console.log(options);
    return mainProxy || new ProxyServer(Object.assign({
        rule: getRuleModule(options.ruleid),
        webInterface: {
            enable: false,
        },
        port: 8001,
        forceProxyHttps: true
    }, options));
}

function proxyCbManager(action, options) {
    if (action === 'start') {
        return function(resolve, reject) {
            if (mainProxy) {
                resolve({
                    msg: MSG_HAD_OPEN_PROXY,
                    open: true,
                    ip: options.ip,
                    port: options.port
                });
            } else {
                console.log('create proxy')
                mainProxy = createProxy(options);

                mainProxy.on('ready', () => {
                    resolve({
                        msg: MSG_OPEN_PROXY_SUCCESS,
                        open: true,
                        ip: options.ip || ip.address(),
                        port: options.port
                    });
                });

                mainProxy.on('error', () => {
                    mainProxy = null;
                    reject({
                        msg: MSG_OPEN_PROXY_ERROR
                    })
                });

                mainProxy.start();
            }
        }
    } else if (action === 'stop') {
        return function(resolve, reject) {
            if (!mainProxy) {
                reject({
                    msg: MSG_HASNOT_OPEN_PROXY
                });
            } else {
                mainProxy.close();
                mainProxy = null;
                resolve({
                    msg: MSG_CLOSE_PROXY_SUCCESS
                });
            }
        }
    }
}

module.exports = {
    /**
     * recorder 相关接口
     */
    getlatestLog() {
        let self = this;
        return new Promise((resolve, reject) => {
            if (global.recorder) {
                global.recorder.getRecords(null, 200, (err, docs) => {
                    if (err) {
                        reject(err.toString());
                    } else {
                        resolve(docs);
                    }
                });
            } else {
                reject();
            }
        });
        
    },
    fetchBody(id) {
        let self = this;
        return new Promise((resolve, reject) => {
            global.recorder.getDecodedBody(id, (err, result) => {
                if (err || !result || !result.content) {
                    reject();
                } else if (result.type && result.type === 'image' && result.mime) {
                    resolve({
                        raw: true,
                        type: result.mime,
                        content: result.content
                    })
                } else {
                    resolve({
                        id: id,
                        type: result.type,
                        content: result.content
                    })
                }
            })
        });
    },
    offUpdate() {
        // global.recorder.off('update');
    },
    onUpdate(callback) {
        console.log('onUpdate');
        global.recorder.on('update', (data) => {
            callback(data);
        });
    },
    /**
     * 证书相关接口
     */
    generateRootCA(successCb, errorCb) {
        const isWin = /^win/.test(process.platform);
        if (!certMgr.ifRootCAFileExists()) {
            certMgr.generateRootCA((error, keyPath) => {
                if (!error) {
                    const certDir = path.dirname(keyPath);
                    console.log('The cert is generated at ', certDir);
                    if (isWin) {
                        exec('start .', {cwd: certDir});
                    } else {
                        exec('open .', {cwd: certDir});
                    }
                    successCb && successCb('证书下载成功，请双击证书安装');
                } else {
                    errorCb && errorCb('证书下载错误');
                    console.error('error when generating rootCA', error);
                }
            });
        } else {
            console.log('c');
            successCb && successCb('证书已存在');
            const rootPath = util.getAnyProxyPath('certificates');
            if (!rootPath) return;
            if (isWin) {
                exec('start .', {cwd: rootPath});
            } else {
                exec('open .', {cwd: rootPath});
            }
        }
    },
    /**
     * 代理相关API
     */
    startProxy(options) {
        const startcb = proxyCbManager('start', options);
        return new Promise(startcb);
    },
    stopProxy(options) {
        const stopcb = proxyCbManager('stop');
        return new Promise(stopcb);
    },
    /**
     * 规则相关API
     */
    readRulesFromFile() {
        if (fs.existsSync(ruleFile)) {
            return fs.readFileSync(ruleFile, 'utf8');
        } else {
            return '[]';
        }
    },
    saveRulesIntoFile(rules) {
        fs.writeFile(ruleFile, JSON.stringify(rules), 'utf8', (err) => {
            if (err) throw err;
        });
    },
    deleteCustomRuleFile(id) {
        const filename = 'custom_' + id + '.js';
        const rulepath = path.resolve(ruleCustomPath, filename);
        if (fs.existsSync(rulepath)) {
            fs.unlink(rulepath, (err) => {
                if (err) throw err;
            });
        }
    },
    saveCustomRuleToFile(id, rule) {
        const filename = 'custom_' + id + '.js';
        if (!fs.existsSync(ruleCustomPath)) {
            fs.mkdir(ruleCustomPath);
        }
        
        const rulepath = path.resolve(ruleCustomPath, filename);

        fs.writeFile(rulepath, rule, 'utf8', (err) => {
            if (err) throw err;
        });
    },
    fetchCustomRule(id) {
        const filename = 'custom_' + id + '.js';
        const rulepath = path.resolve(ruleCustomPath, filename);
        return new Promise((resolve, reject) => {
            if (fs.existsSync(rulepath)) {
                fs.readFile(rulepath, (err, data) => {
                    if (err) {
                        reject('');
                    } else {
                        resolve(data.toString());
                    }
                });
            } else {
                reject('');
            }
        });
    },
    fetchSampleRule(rulename) {
        const filename = 'sample_' + rulename + '.js';
        const rulePath = path.resolve(ruleSamplePath, filename);
        return new Promise((resolve, reject) => {
            if (fs.existsSync(rulePath)) {
                fs.readFile(rulePath, 'utf8', (err, data) => {
                    if (err) {
                        reject('');
                    } else {
                        resolve(data.toString());
                    }
                });
            } else {
                reject('');
            }
        });
    }
}
