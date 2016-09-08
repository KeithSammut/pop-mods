
(function() {
    "use strict";

    window.isNormalTab = true;

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "devtoolstab.html", true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            var html = xhr.responseText;
            var headStart = html.indexOf("<head>") + 7;
            var headEnd = html.indexOf("</head>");
            var bodyStart = html.indexOf("<body>") + 7;
            var bodyEnd = html.indexOf("</body>");

            document.head.innerHTML = html.substring(headStart, headEnd);
            document.body.innerHTML = html.substring(bodyStart, bodyEnd);
            setTimeout(window.init, 0);
        }
    };

    xhr.send();
})();
