chrome.extension.sendMessage({action: "getSetting", setting: "devTools"}, function(data) {
    if (data === "true") {
        chrome.devtools.panels.create("Extensions",
            "",
            "src/ui/devtoolstab.html",
            function(panel) {}
        );
    }
});
