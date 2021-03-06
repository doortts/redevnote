// Following code blocks are written for 'go to recently' select2 box feature
$(function(){
    var SELECT2_CONFIG = {
        "container-css-class" : "fullsize",
        formatResult: format,
        formatSelection: format,
        matcher: fuzzyMatcher
    };

    // add pjax event at GoTo-Recently button
    $("#goto-recently-container").pjax('a[data-pjax]', '#goto-recently-container', {push: false, timeout: 8000});

    _addGotoRecentlyContainerHideEvent();
    _showNewCommentsAddedMessageIfExists();

    $(document).on("keypress", function triggerGoToLinkByShortcutKey(event) {
        if (isShortcutKeyPressed(event)) {
            var target = $("#goto-link");
            target.trigger("click");
            preventAdditionalClick(target);
        }
    });

    $("#goto-recently-container").on('pjax:send', function(){
        var target = $("#goto-link");
        showLoading(target);
        preventAdditionalClick(target);
        NProgress.start()
    });

    $("#goto-recently-container").on('pjax:end', function(){
        $("#visitedPage").select2();    //prevent timing bug at chrome

        addShortcutAndUIEffectAtGoToRecently();
        addEventAtGoToRecentlySelectBox();
        addHideEventAtGoToDummyButton();
        _showNewCommentsAddedMessageIfExists();

        setTimeout(function(){  //prevent timing bug at chrome
            $("#visitedPage").select2(SELECT2_CONFIG);
            $('#visitedPage').select2("open");
        }, 1);
        NProgress.done();
    });

    $(document).on('pjax:timeout', function(e){
        $yobi.notify("Timeout! server is busy?", 5000);
        e.preventDefault();
    });

    function preventAdditionalClick(target) {
        target.removeAttr('onclick');
    }

    function showLoading(target) {
        target.html("<span style='color: #51AACC'><i class='yobicon-loading'></i> loading...</span>");
        target.animate({width: "450px"});
    }

    function format(itemObject){
        var element = $(itemObject.element);
        var author = _extractAuthorOrOwner(element);
        var avatarURL = element.data("avatarUrl");
        var isUpdated = $(element.data("isUpdated"));

        if(_hasProjectAvatar(avatarURL)){
            return $yobi.tmpl($("#tplVisitedPageWithAvatar").text(), {
                "name"      : itemObject.text,
                "url"       : _extractProjectNameAndNo(element.attr("title")),
                "author"    : author,
                "avatarURL" : avatarURL
            });
        } else {
            return $yobi.tmpl($("#tplVisitedPage").text(), {
                "name"      : itemObject.text,
                "url"       : _extractProjectNameAndNo(element.attr("title")),
                "author"    : author,
                "isUpdated" : element.data("isUpdated") || ""
            });
        }

        function _extractAuthorOrOwner(itemElement) {
            var authorName = itemElement.data("author");
            if (authorName) {
                authorName = authorName.substring(0, authorName.lastIndexOf("@")); //abandon loginId from title
            }
            return authorName || itemElement.data("owner"); //user owner for author if author doesn't provide
        }

        function _extractProjectNameAndNo(title){ //parse project name if title is path
            if(title){
                var parsed = title.split("/"); //expectation: ["", owner, projectname, issue/board/pullrequest, number]
                if (parsed[3] && _getNumberPrefixForPageType(parsed[3])) {
                    return parsed[2] + _getNumberPrefixForPageType(parsed[3]) + parsed[4] || title; //add # for issue
                }
            }
            return title;
        }

        function _hasProjectAvatar(avatarURL) {
            var DEFAULT_PROJECT_LOGO = "project_default_logo.png";
            var DEFAULT_ORGANIZATION_LOG = "group_default.png";
            return avatarURL
                && avatarURL.indexOf(DEFAULT_PROJECT_LOGO) == -1
                && avatarURL.indexOf(DEFAULT_ORGANIZATION_LOG) == -1
        }
    }

    function _isPullRequestPage(path){
        if(path){
            var parsed = path.split("/"); //expectation: ["", owner, projectname, issue/board/pullrequest, number]
            if (parsed[3]) {
                return parsed[3].toLowerCase() === "pullrequest";
            }
        }
        return false;
    }

    function _getNumberPrefixForPageType(type){
        var pageType = type.toLowerCase();
        if(pageType === "issue") {
            return " #";
        } else if (pageType === "post"){
            return " ";
        } else if (pageType === "pullrequest"){
            return " %";
        }
        return "";
    }

    /**
     * fuzzy matcher
     *
     * Standard fuzzy matcher implementation except that
     * it use depth & searched item memoization for performance.
     *
     * @param search: search keywords
     * @param text: target text
     * @param itemElement: select option html
     * @returns {boolean}: isMatched or not
     */
    var resultMap = {};  // for memoization
    var prevDepth = 0;   // index for memoization depth according to search text length

        function isMatchedAlreadyAtPreviousDepth(currentDepth, text) {
        return resultMap[currentDepth - 1].indexOf(text) == -1;
    }

    function fuzzyMatcher(search, text, itemElement) {

        //
        // preparation start
        //
        // 1. workaround tooltip bug
        _removeGarbageTooltip();

        // 2. include path string at search
        var path = itemElement.data("path");
        var isUpdated = itemElement.data("is-updated") ? "/!!" : ""; // marker for newly updated page
        var parsedPath;
        var prefixForPage = "#/" + isUpdated;
        if(path){
            parsedPath = path.split("/");
            if(parsedPath.length < 4){
                console.log("Wrong url path format: ", path);
                return;
            }
            text = parsedPath[2] + text + _getNumberPrefixForPageType(parsedPath[3]) + parsedPath[4];    // projectName + no
            text = prefixForPage + text.replace(/\//g, ""); // remove slashes in path url
        }

        // 3. include author string at search
        var author = itemElement.data("author");
        var mentionPrefix = "@";
        if(author){
            text += mentionPrefix + author;
        }

        // 4. change to uppercase
        search = search.toUpperCase();
        text = text.toUpperCase();
        // preparations end here

        //
        // fuzzy search start from here
        //
        // 1. arrange search word depth
        var currentDepth = search.length;

        if(prevDepth > currentDepth){       // if depth is decreased, remove previous depth search result
            resultMap[prevDepth] = [];
            prevDepth = currentDepth;
        }

        if(prevDepth + 1 === currentDepth){ // enter deeper state
            resultMap[currentDepth] = [];   // ready for new depth of memo
            prevDepth = currentDepth;
        }

        if(currentDepth > 1 && isMatchedAlreadyAtPreviousDepth(currentDepth, text)){ // filtering start at 2th depth
            return false;
        }

        // 2. match character
        var lastFoundPosition = -1;              // remembers position of last found character
        for (var i = 0; i < currentDepth; i++) { // consider each search character one at a time
            var char = search[i];
            if (char == ' ') continue;           // ignore spaces

            lastFoundPosition = text.indexOf(char, lastFoundPosition + 1);   // search for character & update position
            if (lastFoundPosition == -1) {       // if it's not found, exclude this item
                return false;
            }
        }

        // 3. store matched text
        if (currentDepth !== 0){                 // ignore when search text doesn't exist
            resultMap[currentDepth].push(text);
        }
        return true;
    }

    function _removeGarbageTooltip() { // remove garbage tooltip (tooltip bug workaround)
        setTimeout(function () {
            $('.tooltip.right.in').remove();
        }, 10);
    }

    // to prevent css width calculation bug when auto calculated width has point value
    function addShortcutAndUIEffectAtGoToRecently() {
        if( $("#visitedPage").length ) {
            // to prevent flickering
            $("#visitedPage").css("visibility", "visible");
            $("#s2id_visitedPage").css("visibility", "visible");

            _openSelectBoxWithShortcutKey();
        }

        //in case of mouse click
        $('#visitedPage').on("select2-highlight, select2-opening", function(){
            $("ul.gnb-nav").hide();
            $("#s2id_visitedPage").show();
            _patchForWebkit();
        });

        //resize select2 div to default width
        $('#visitedPage').on("select2-close", function(){
            // to bypass select2 malfunction that select2 focus never blurred automatically
            // when drop-down was closed.
            $("ul.gnb-nav").show(200);
            setTimeout(function(){
                $('.select2-container-active').removeClass('select2-container-active');
                $(':focus').blur();
                $("#visitedPage").hide();
                $("#s2id_visitedPage").hide();
                $("#goto-link-dummy").show();
                addHideEventAtGoToDummyButton();
            }, 1);
        });

        function _openSelectBoxWithShortcutKey() {
            $(document).on("keypress", function (event) {
                if (isShortcutKeyPressed(event)) {
                    $("ul.gnb-nav").hide();
                    $("#goto-link-dummy").hide();
                    setTimeout(function () {
                        $('#visitedPage').select(SELECT2_CONFIG);
                        $('#visitedPage').select2("open");
                    }, 1);
                }
            })
        }

        var _patchForWebkit = function () {
            var isSafari = navigator.userAgent.indexOf('Safari') != -1 && navigator.userAgent.indexOf('Chrome') == -1;
            var isChrome = !!window.chrome;
            if(isChrome || isSafari){
                //select2 scrollbar is too thick in chrome, so hide tooltip.
                //To prevent it, additional css is required.
                $(".select2-results").addClass("webkitScrollbar");
            }
        };
    }

    function addEventAtGoToRecentlySelectBox() {
        $("#visitedPage" ).on("change", function(choice){
            if($(choice.added.element[0]).data("isUpdated")){
                if( _isPullRequestPage(choice.val)){
                    location.href= choice.val + "/lastComment";
                } else {
                    location.href= choice.val + "#last-comment";
                }
            } else {
                location.href= choice.val;
            }
        });
    }

    // to prevent select2 box irregular style add dummy select box
    function addHideEventAtGoToDummyButton() {
        $("#goto-link-dummy").one("click", function(){
            $(this).hide();
            $("ul.gnb-nav").hide();
            setTimeout(function () {
                $('#visitedPage').select(SELECT2_CONFIG);
                $('#visitedPage').select2("open");
            }, 1);
        });
    }

    function isShortcutKeyPressed(event) {
        var activeElementName = $(document.activeElement).prop("tagName").toUpperCase();
        if(["INPUT","TEXTAREA"].indexOf(activeElementName) !== -1){ // avoid already somewhere input focused state
            return false;
        }
        return (event.which == 106 || event.which == 12627);     // keycode => 106: j, 12627: ㅓ
    }

    function _addGotoRecentlyContainerHideEvent() {
        // Hide other elements when global search box is focused
        $(".search-box > input[name='keyword']").on("focus", function(){
            $("#goto-recently-container").hide();
        }).on("blur", function(){
            $("#goto-recently-container").show(200);
        });
    }

    function _showNewCommentsAddedMessageIfExists() {
        $.ajax({
            url: "/user/existsRecentlyAddedComments"
        }).done(function(data){
            if(data.newComments){
                $(".new-comments").show();
            } else {
                $(".new-comments").hide();
            };
        });
    }
});

