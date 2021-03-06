(function() {
    "use strict";

    var fileTypeToTag = {
        js: "script",
        css: "style"
    };

    var processDomain = function(domain) {
        var rules = domain.rules || [];
        rules.forEach(function(rule) {
            if (rule.on && rule.type === "fileInject") {
                var newEl = document.createElement(fileTypeToTag[rule.fileType] || "script");
                newEl.appendChild(document.createTextNode(rule.file));
                if (rule.injectLocation === "head") {
                    var firstEl = document.head.children[0];
                    if (firstEl) {
                        document.head.insertBefore(newEl, firstEl);
                    } else {
                        document.head.appendChild(newEl);
                    }
                } else {
                    if (document.body) {
                        document.body.appendChild(newEl);
                    } else {
                        document.addEventListener("DOMContentLoaded", function() {
                            document.body.appendChild(newEl);
                        });
                    }
                }
            }
        });
    };

    chrome.extension.sendMessage({action: "getDomains"}, function(domains) {
        domains = domains || [];
        domains.forEach(function(domain) {
            if (domain.on) {
                chrome.extension.sendMessage({
                    action: "match",
                    domainUrl: domain.matchUrl,
                    windowUrl: location.href
                }, function(result) {
                    if (result) {
                        processDomain(domain);
                    }
                });
            }
        });
    });

    chrome.extension.onMessage.addListener(function(msg) {
        if (msg.action === 'log') {
            var logStyle = "color: #007182; font-weight: bold;";
            if (msg.important) {
                logStyle += "background: #AAFFFF;";
            }
            console.log("" + msg.message, logStyle);
        }
    });
})();
