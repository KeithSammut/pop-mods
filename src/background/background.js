(function() {
    "use strict";

    var lastRequestId;
    var ruleDomains = {};
    var syncFunctions = [];

    var logOnTab = function(tabId, message, important) {
        if (localStorage.showLogs === "true") {
            important = !!important;
            chrome.tabs.sendMessage(tabId, {
                action: "log",
                message: message,
                important: important
            });
        }
    };

    var tabUrlTracker = (function() {
        var urls = {};
        var closeListeners = [];

        var queryTabsCallback = function(allTabs) {
            if (allTabs) {
                allTabs.forEach(function(tab) {
                    urls[tab.id] = tab.url;
                });
            }
        };

        var updateTabCallback = function(tabId, changeinfo, tab) {
            urls[tabId] = tab.url;
        };

        var tabReplacedCallback = function(newTabId, oldTabId) {
            delete urls[oldTabId];
            chrome.tabs.get(newTabId, function(tab) {
                urls[tab.id] = tab.url;
            });
        };

        var removeTabCallback = function(tabId) {
            closeListeners.forEach(function(fn) {
                fn(urls[tabId]);
            });
            delete urls[tabId];
        };

        // init
        chrome.tabs.query({}, queryTabsCallback);
        chrome.tabs.onUpdated.addListener(updateTabCallback);
        chrome.tabs.onRemoved.addListener(removeTabCallback);
        chrome.tabs.onReplaced.addListener(tabReplacedCallback);

        return {
            getUrlFromId: function(id) {
                return urls[id];
            }
        };
    })();

    var simpleError = function(err) {
        if (err.stack) {
            console.error("=== Printing Stack ===");
            console.error(err.stack);
        }
        console.error(err);
    };

    var domainStorage = (function() {
        var db = keyvalDB("OverrideDB", [{store: "domains", key: "id"}], 1);
        var domainStore = db.usingStore("domains");

        var put = function(domainData) {
            return new Promise(function(res, rej) {
                db.open(function(err) {
                    if (err) {
                        console.error(err);
                        rej(err);
                    } else {
                        domainStore.upsert(domainData.id, domainData, function(err) {
                            if (err) {
                                console.error(err);
                                rej(err);
                            } else {
                                res();
                            }
                        });
                    }
                });
            });
        };

        var getDomains = function() {
            return new Promise(function(res, rej) {
                db.open(function(err) {
                    if (err) {
                        console.error(err);
                        rej(err);
                    } else {
                        domainStore.getAll(function(err, ans) {
                            if (err) {
                                console.error(err);
                                rej(err);
                            } else {
                                res(ans);
                            }
                        });
                    }
                });
            });
        };

        var deleteDomain = function(id) {
            return new Promise(function(res, rej) {
                db.open(function(err) {
                    if (err) {
                        console.error(err);
                        rej(err);
                    } else {
                        domainStore.delete(id, function(err) {
                            if (err) {
                                console.error(err);
                                rej(err);
                            } else {
                                res();
                            }
                        });
                    }
                });
            });
        };

        return {
            put: put,
            getAll: getDomains,
            delete: deleteDomain
        };
    })();

    var openOrFocusOptionsPage = function() {
        var optionsUrl = chrome.extension.getURL("src/ui/options.html");
        chrome.tabs.query({}, function(extensionTabs) {
            var found = false;
            for (var i = 0, len = extensionTabs.length; i < len; i++) {
                if (optionsUrl === extensionTabs[i].url) {
                    found = true;
                    chrome.tabs.update(extensionTabs[i].id, {selected: true});
                    break;
                }
            }
            if (found === false) {
                chrome.tabs.create({url: optionsUrl});
            }
        });
    };

    var syncAllInstances = function() {

        syncFunctions.forEach(function(fn) {
            try {
                fn();
            } catch(e) {}
        });
        syncFunctions = [];
    };


    var extractMimeType = function(requestUrl, file) {
        file = file || "";
        var possibleExt = (requestUrl.match(/\.[A-Za-z]{2,4}$/) || [""])[0];
        var looksLikeCSSRegex = /[#.@][^\s\{]+\s*\{/;
        var looksLikeJSRegex = /(var|const|let|function)\s+.+/;
        var looksLikeXMLRegex = /<\?xml(\s+.+\s*)?\?>/i;
        var looksLikeHTMLRegex = /<html(\s+.+\s*)?>/i;
        var mimeInFileRegex = /\/\* *mime: *([-\w\/]+) *\*\//i;
        var firstLine = (file.match(/.*/) || [""])[0];
        var userMime = firstLine.match(mimeInFileRegex);
        userMime = userMime ? userMime[1] : null;
        var extToMime = {
            ".js": "text/javascript",
            ".html": "text/html",
            ".css": "text/css",
            ".xml": "text/xml"
        };
        var mime = extToMime[possibleExt];
        if (!mime) {
            if (looksLikeHTMLRegex.test(file)) {
                mime = "text/html";
            } else if (looksLikeXMLRegex.test(file)) {
                mime = "text/xml";
            } else if (looksLikeJSRegex.test(file)) {
                mime = "text/javascript";
            } else if (looksLikeCSSRegex.test(file)) {
                mime = "text/css";
            } else {
                mime = "text/plain";
            }
        }
        if (userMime) {
            mime = userMime;
            file = file.replace(mimeInFileRegex, "");
        }
        return {mime: mime, file: file};
    };

    var handleRequest = function(requestUrl, tabUrl, tabId) {
        for (var key in ruleDomains) {
            var domainObj = ruleDomains[key];
            if (domainObj.on && match(domainObj.matchUrl, tabUrl).matched) {
                var rules = domainObj.rules || [];
                for (var x = 0, len = rules.length; x < len; ++x) {
                    var ruleObj = rules[x];
                    if (ruleObj.on) {
                        if (ruleObj.type === "normalOverride") {
                            var matchedObj = match(ruleObj.match, requestUrl);
                            var newUrl = matchReplace(matchedObj, ruleObj.replace, requestUrl);
                            if (matchedObj.matched) {
                                logOnTab(tabId, "URL Override Matched: " + requestUrl +
                                    "   to:   " + newUrl + "   match url: " + ruleObj.match, true);
                                if (requestUrl !== newUrl) {
                                    return {redirectUrl: newUrl};
                                } else {
                                    return;
                                }
                            }
                        } else if (ruleObj.type === "fileOverride" &&
                            match(ruleObj.match, requestUrl).matched) {

                            logOnTab(tabId, "File Override Matched: " + requestUrl + "   match url: " +
                                ruleObj.match, true);

                            var mimeAndFile = extractMimeType(requestUrl, ruleObj.file);

                            return {redirectUrl: "data:" + mimeAndFile.mime + ";charset=UTF-8;base64," +
                                btoa(unescape(encodeURIComponent(mimeAndFile.file)))};
                        }
                    }
                }
                logOnTab(tabId, "No override match for: " + requestUrl);
            } else {
                logOnTab(tabId, "Rule is off or tab URL does not match: " + domainObj.matchUrl);
            }
        }
    };

    chrome.browserAction.onClicked.addListener(function(tab) {
        openOrFocusOptionsPage();
    });

    chrome.extension.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === "saveDomain") {
            domainStorage.put(request.data)
                .then(syncAllInstances)
                .catch(simpleError);
            ruleDomains[request.data.id] = request.data;
        } else if (request.action === "getDomains") {
            domainStorage.getAll().then(function(domains) {
                sendResponse(domains || []);
            }).catch(simpleError);
        } else if (request.action === "deleteDomain") {
            domainStorage.delete(request.id)
                .then(syncAllInstances)
                .catch(simpleError);
            delete ruleDomains[request.id];
        } else if (request.action === "import") {
            var maxId = 0;
            for (var id in ruleDomains) {
                maxId = Math.max(maxId, parseInt(id.substring(1)));
            }
            maxId++;
            Promise.all(request.data.map(function(domainData) {
                domainData.id = "d" + maxId++;
                ruleDomains[domainData.id] = domainData;
                return domainStorage.put(domainData);
            }))
            .then(syncAllInstances)
            .catch(simpleError);
        } else if (request.action === "makeGetRequest") {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", request.url, true);
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    sendResponse(xhr.responseText);
                }
            };
            xhr.send();
        } else if (request.action === "setSetting") {
            localStorage[request.setting] = request.value;
        } else if (request.action === "getSetting") {
            sendResponse(localStorage[request.setting]);
        } else if (request.action === "syncMe") {
            syncFunctions.push(sendResponse);
        } else if (request.action === "match") {
            sendResponse(match(request.domainUrl, request.windowUrl).matched);
        } else if (request.action === "extractMimeType") {
            sendResponse(extractMimeType(request.fileName, request.file));
        }

        return true;
    });

    chrome.webRequest.onBeforeRequest.addListener(function(details) {
        if (details.requestId !== lastRequestId) {
            lastRequestId = details.requestId;
            if (details.tabId > -1) {
                var tabUrl = tabUrlTracker.getUrlFromId(details.tabId);
                if (tabUrl) {
                    return handleRequest(details.url, tabUrl, details.tabId);
                } else if (!tabUrl && details.type === "main_frame") {
                    return handleRequest(details.url, details.url, details.tabId);
                }
            }
        }
    }, {
        urls: ["<all_urls>"]
    }, ["blocking"]);

    if (localStorage.devTools === undefined) {
        localStorage.devTools = "true";
    }
    if (localStorage.showSuggestions === undefined) {
        localStorage.showSuggestions = "true";
    }
    if (localStorage.showLogs === undefined) {
        localStorage.showLogs = "false";
    }

    domainStorage.getAll().then(function(domains) {
        if (domains) {
            domains.forEach(function(domainObj) {
                ruleDomains[domainObj.id] = domainObj;
            });
        }
    }).catch(simpleError);

})();
