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

    function getXPosition(panel, editor) {
        var x = editor.boxObject.width;
        // The || case when the panel doesn't have a size - we'll guess and
        // we'll recalculate it after the panel is shown.
        return x - (panel.boxObject.width || 120) - 2;
    }

    this.openPopup = function(view) {
        log.debug("openPopup");
        if (!this.panel) {
            this.panel = document.getElementById("extension_markdown_panel");
            // Komodo 9 and above will set the type to "drag".
            if (typeof(require) == "function") {
                this.panel.setAttribute("type", "drag");
            }
        }

        if (!view) {
            view = ko.views.manager.currentView;
        }
        var editor = view.scintilla;
        var x = getXPosition(this.panel, editor);
        var editorBox = editor.boxObject;
        this.panel.openPopup(editor, null, editorBox.screenX + x, editorBox.screenY);
        this.panel.moveTo(editorBox.screenX + x, editorBox.screenY);
    }

    this.hidePopup = function() {
        if (!this.panel) {
            return; // It's not been created yet.
        }
        log.debug("hidePopup");
        this.panel.hidePopup();
    }

    this.repositionPopup = function(view) {
        log.debug("repositionPopup");
        if (!view) {
            view = ko.views.manager.currentView;
        }
        if (!view) {
            view = ko.views.manager.currentView;
        }
        var editor = view.scintilla;
        var x = getXPosition(this.panel, editor);
        var editorBox = editor.boxObject;
        this.panel.moveTo(editorBox.screenX + x, editorBox.screenY);
    }

    this.getSettings = function(view) {
        if (!("_extension_markdown" in view)) {
            view._extension_markdown = {
                "previewing": false,  // currently previewing
            };
        }
        return view._extension_markdown;
    }

    this.createPreview = function(view, orient) {
        // Watch for editor changes, to update the markdown view.
        log.debug("adding event listeners for 'editor_text_modified' and 'view_closed'");
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
        this.updatePreview(view);
    }

    this.updatePreview = function(view) {
        updatepreview_timeout_id = null;
        var mdocument = markdown_view.browser.contentDocument;

        // Wait till the browser is loaded.
        if (mdocument.readyState != 'complete') {
            updatepreview_timeout_id = setTimeout(this.updatePreview.bind(this, view), 50);
        }
        
        // Change the tab label.
        mdocument.title = view.title + ' (preview)';

        var mwindow = mdocument.ownerGlobal;

        // Set markdown options.
        if (!mwindow.setMarkedOptions) {
            mwindow.setMarkedOptions = true;
            // TODO: Could be exposed as user preferences.
            mwindow.marked.setOptions({
                renderer: new mwindow.marked.Renderer(),
                gfm: true,
                tables: true,
                breaks: false,
                pedantic: true,
                sanitize: false,
                smartLists: true,
                smartypants: false,
            });
        }

        // Generate and load markdown html into the browser view.
        var mwrap = mdocument.getElementById("wrap");
        var text = view.scimoz.text;
        mwrap.innerHTML = mwindow.marked(text);

        // Highlight the code sections.
        var blocks = mdocument.querySelectorAll('code[class^=lang-]');
        Array.prototype.forEach.call(blocks, mwindow.hljs.highlightBlock);
    }

    this.closeMarkdownView = function(deleteSettings=false, closeView=true) {
        this.hidePopup();
        // Closing the markdown browser preview and remove event listeners.
        if (markdown_view) {
            log.debug("removing event listeners for 'editor_text_modified' and 'view_closed'");
            window.removeEventListener("editor_text_modified", this.handlers.onmodified);
            window.removeEventListener("view_closed", this.handlers.onviewclosed);
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
            window.addEventListener("resize", this.onviewresize.bind(this));
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
            var view = ko.views.manager.currentView;
            if (view.getAttribute("type") != "editor") {
                log.debug("not an editor view");
                return;  // Ignore non-editor views.
            }
            var settings = this.getSettings(view);
            if (!settings.previewing) {
                this.createPreview(view, orient);
            } else {
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
                extensions.markdown.openPopup(view);
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

}).apply(extensions.markdown);

// Event listeners:
//window.addEventListener("load", extensions.markdown.onload.bind(extensions.markdown));
window.addEventListener("komodo-ui-started", extensions.markdown.onkomodostartup.bind(extensions.markdown));
