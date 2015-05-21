if (!("extensions" in window)) {
    window.extensions = {};
}
extensions.markdown = {};

(function() {
    if (typeof(require) == "function") {
        // Komodo 9 or above.
        var log = require("ko/logging").getLogger("extensions.markdown");
        //log.setLevel(log.DEBUG);
    } else {
        // Komodo 8 or earlier.
        var log = ko.logging.getLogger("extensions.markdown");
        //log.setLevel(ko.logging.DEBUG);
    }

    // A reference to the current markdown browser view.
    var markdown_view = null;
    var updatepreview_timeout_id = null;

    // The onmodified update delay (in milliseconds).
    this.UPDATE_DELAY = 500;

    this.getSettings = function(view) {
        var result = {
            "previewing": false,  // currently previewing
        };
        
        if (!view) {
            var vm = ko.views.manager;
            var view = vm.currentView.getAttribute("type") == "editor" ? vm.currentView :
                                                                         vm.topView.otherView.currentView;
            if (view.getAttribute("type") != "editor") {
                return result;  // Ignore non-editor views.
            }
        }
        
        if (!("_extension_markdown" in view)) {
            view._extension_markdown = result;
        }
        return view._extension_markdown;
    }

    this.createPreview = function(view, orient) {
        // Watch for editor changes, to update the markdown view.
        log.debug("adding event listeners for 'editor_text_modified' and 'view_closed'");
        window.removeEventListener("view_closed", this.handlers.onviewclosed); // remove existing listener, if any
        window.addEventListener("editor_text_modified", this.handlers.onmodified);
        window.addEventListener("view_closed", this.handlers.onviewclosed);

        view.createInternalViewPreview("chrome://markdown-viewer/content/template.html", view.alternateViewList);

        // Change orient if necessary.
        if (orient && ko.views.manager.topView.getAttribute("orient") != orient) {
            ko.views.manager.topView.changeOrient();
        }

        // Store settings.
        markdown_view = view.preview;
        markdown_view._extension_markdown = { "backRef": view };
        markdown_view.setAttribute("sub-type", "markdown");
        var settings = this.getSettings(view);
        settings.previewing = true;
        view.preview = null;

        // Change the tab label:
        markdown_view.title = "Markdown - " + view.title;

        this.updatePreview(view);
    }

    this.updatePreview = function(view) {
        updatepreview_timeout_id = null;
        var mdocument = markdown_view.browser.contentDocument;

        // Wait till the browser is loaded.
        if (mdocument.readyState != 'complete') {
            return setTimeout(this.updatePreview.bind(this, view), 50);
        }

        var mwindow = mdocument.ownerGlobal;

        // Set markdown options.
        //if (!mwindow.setMarkedOptions) {
        //    mwindow.setMarkedOptions = true;
        //    // TODO: Could be exposed as user preferences.
        //    mwindow.marked.setOptions({
        //        renderer: new mwindow.marked.Renderer(),
        //        gfm: true,
        //        tables: true,
        //        breaks: false,
        //        pedantic: false,
        //        sanitize: true,
        //        smartLists: true,
        //        smartypants: false,
        //    });
        //}

        // Generate and load markdown html into the browser view.
        var mwrap = mdocument.getElementById("wrap");
        var text = view.scimoz.text;
        mwrap.innerHTML = mwindow.marked(text);

        // Highlight the code sections.
        var blocks = mdocument.querySelectorAll('pre code');
        Array.prototype.forEach.call(blocks, mwindow.hljs.highlightBlock);
    }

    this.closeMarkdownView = function(deleteSettings=false, closeView=true) {
        // Closing the markdown browser preview and remove event listeners.
        if (markdown_view) {
            log.debug("removing event listeners for 'editor_text_modified' and 'view_closed'");
            window.removeEventListener("editor_text_modified", this.handlers.onmodified);
            window.removeEventListener("current_view_changed", this.handlers.onviewchanged);
            if (deleteSettings) {
                delete markdown_view._extension_markdown;
            }
            if (closeView && markdown_view.close) {
                log.debug("closing markdown browser preview");
                markdown_view.close();
            }
            markdown_view = null;
        }
    }

    /** Event Listeners **/

    this.onkomodostartup = function(event) {
        try {
            this.handlers = {};
            // Store references to bound functions, so can add/remove them.
            this.handlers.onviewchanged = this.onviewchanged.bind(this);
            this.handlers.onviewlistclosed = this.onviewlistclosed.bind(this);
            this.handlers.onviewclosed = this.onviewclosed.bind(this);
            this.handlers.onmodified = this.onmodified.bind(this);
            this.handlers.onkomodoshutdown = this.onkomodoshutdown.bind(this);

            ko.main.addWillCloseHandler(this.handlers.onkomodoshutdown);
            window.addEventListener("current_view_changed", this.handlers.onviewchanged);
            window.addEventListener("view_list_closed", this.handlers.onviewlistclosed);

            // Register a preview command - Komodo 9 or above.
            if (typeof(require) == "function") {
                const commands  = require("ko/commands");
                commands.register("markdown-preview", this.onpreview.bind(this),
                                  { label: "Markdown: Generate markdown preview" });
            }

            // TODO: Need a way to detect that a view has been resized!
            //window.addEventListener("resize", this.onviewresize.bind(this));
            this.onviewchanged();
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onkomodoshutdown = function() {
        // Remove all event handlers.
        window.removeEventListener("current_view_changed", this.handlers.onviewchanged);
        window.removeEventListener("view_list_closed", this.handlers.onviewlistclosed);
        window.removeEventListener("view_closed", this.handlers.onviewclosed);
        window.removeEventListener("editor_text_modified", this.handlers.onmodified);
    }

    this.onviewresize = function(event) {
        try {
            if (this.panel.state == "open") {
                this.repositionPopup();
            }
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onpreview = function(event, orient) {
        try {
            log.debug("onpreview");
            var vm = ko.views.manager;
            var view = vm.currentView.getAttribute("type") == "editor" ? vm.currentView :
                                                                         vm.topView.otherView.currentView;
            if (!view || view.getAttribute("type") != "editor") {
                log.debug("not an editor view");
                return;  // Ignore non-editor views.
            }
            var settings = this.getSettings(view);
            if (!settings.previewing) {
                this.createPreview(view, orient);
            } else {
                // Rotate the view if its already being previewed
                var topView = ko.views.manager.topView;
                if (orient && ! topView.currentView.collapsed && ! topView.otherView.collapsed) {
                    if (topView.getAttribute("orient") != orient) {
                        ko.commands.doCommandAsync("cmd_rotateSplitter");
                    }
                }
                this.updatePreview(view);
            }
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onviewchanged = function(event) {
        try {
            var view = event && event.originalTarget || ko.views.manager.currentView;
            if (!view) {
                this.closeMarkdownView();
                return;
            }
            var viewtype = view.getAttribute("type");
            if (viewtype == "browser" && view.getAttribute("sub-type") == "markdown") {
                // Just switching to the markdown view - that's fine.
                log.debug("onviewchanged: switched to the markdown preview - ignoring");
                return;
            }
            if (viewtype != "editor" || view.language != "Markdown") {
                this.closeMarkdownView();
                return;
            }
            // Create an object to hold our markdown state information.
            var settings = this.getSettings(view);
            if (!settings.previewing) {
                log.debug("onviewchanged: it's a markdown file with no preview");
                this.closeMarkdownView();
            } else if (!markdown_view) {
                log.debug("onviewchanged: re-display the markdown preview");
                this.createPreview(view);
            } else {
                log.debug("onviewchanged: already showing the markdown view");
            }
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onviewclosed = function(event) {
        try {
            log.debug("onviewclosed");
            var view = event.originalTarget;
            if ("_extension_markdown" in view) {
                if (view._extension_markdown.backRef) {
                    log.debug("onviewclosed - closed markdown browser preview");
                    var fileSettings = this.getSettings(view._extension_markdown.backRef);
                    fileSettings.previewing = false;
                    this.closeMarkdownView(true /* delete the settings */, false /* don't close it again */);
                } else if (view._extension_markdown.previewing) {
                    log.debug("onviewclosed - closed editor view which has a markdown preview");
                    // Closing the markdown editor file - close the browser view
                    // - it's useless without the accompanying file.
                    // Requires a setTimeout, otherwise errors will ensue.
                    setTimeout(this.closeMarkdownView.bind(this));
                }
                delete view._extension_markdown;
            }
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onviewlistclosed = function(event) {
        try {
            this.closeMarkdownView();
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onmodified = function(event) {
        try {
            if (updatepreview_timeout_id) {
                // Existing timeout, just leave it.
                return;
            }
            log.debug("onmodified: event");
            var view = event.data.view;
            if (!("_extension_markdown" in view) || !view._extension_markdown.previewing) {
                return;
            }
            log.debug("onmodified: it's a Markdown file!");
            updatepreview_timeout_id = setTimeout(this.updatePreview.bind(this, view), this.UPDATE_DELAY);
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.controller = {
        do_cmd_markdownPreview: function(e)
        {
            if (this._ignoreNext) {
                this._ignoreNext = false;
                return;
            }
            
            var settings = extensions.markdown.getSettings();
            if (!settings.previewing) 
                extensions.markdown.onpreview(e);
            else
                extensions.markdown.closeMarkdownView();
        },

        is_cmd_markdownPreview_enabled: function()
        {
            var view = ko.views.manager.currentView;
            return view.language == "Markdown" ||
                    (view.getAttribute("type") == "browser" &&
                     view.getAttribute("sub-type") == "markdown");
        },

        do_cmd_markdownPreviewVertical: function(e)
        {
            this._ignoreNext = true;
            setTimeout(function() { this._ignoreNext = false; }.bind(this), 100);
            extensions.markdown.onpreview(e, 'vertical');
        },

        is_cmd_markdownPreviewVertical_enabled: function()
        {
            return this.is_cmd_markdownPreview_enabled();
        },

        do_cmd_markdownPreviewHorizontal: function(e)
        {
            this._ignoreNext = true;
            setTimeout(function() { this._ignoreNext = false; }.bind(this), 100);
            extensions.markdown.onpreview(e, 'horizontal');
        },

        is_cmd_markdownPreviewHorizontal_enabled: function()
        {
            return this.is_cmd_markdownPreview_enabled();
        },

        /**
         * Check whether command is supported
         *
         * @param   {String} command
         *
         * @returns {Bool}
         */
        supportsCommand: function(command)
        {
            return ("do_" + command) in this;
        },

        /**
         * Check whether command is enabled
         *
         * @param   {String} command
         *
         * @returns {Bool}
         */
        isCommandEnabled: function(command)
        {
            var method = "is_" + command + "_enabled";
            return (method in this) ?
                    this["is_" + command + "_enabled"]() : true;
        },

        /**
         * Execute command
         *
         * @param   {String} command
         *
         * @returns {Mixed}
         */
        doCommand: function(command)
        {
            return this["do_" + command]();
        }
    };

}).apply(extensions.markdown);

// Event listeners:
//window.addEventListener("load", extensions.markdown.onload.bind(extensions.markdown));
window.addEventListener("komodo-ui-started", extensions.markdown.onkomodostartup.bind(extensions.markdown));
window.controllers.appendController(extensions.markdown.controller);
