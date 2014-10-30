if (!("extensions" in window)) {
    window.extensions = {};
}
extensions.markdown = {};

(function() {
    var log = require("ko/logging").getLogger("extensions.markdown");
    log.setLevel(log.DEBUG);

    // Keep track of how many markdown files we are previewing.
    var markdown_browser_count = 0;

    // Creating the UI.
    function createXULElement(tagName, attributes) {
        var elem = document.createElement(tagName);
        if (attributes) {
            for (var attr of Object.keys(attributes)) {
                elem.setAttribute(attr, attributes[attr]);
            }
        }
        return elem;
    }

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
        }

        if (!view) {
            view = ko.views.manager.currentView;
        }
        var editor = view.scintilla;
        var x = getXPosition(this.panel, editor);
        this.panel.openPopup(editor, null, x, 0);
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
                "browserview": null,
            };
        }
        return view._extension_markdown;
    }

    this.createPreview = function(view, orient) {
        if (markdown_browser_count == 0) {
            markdown_browser_count += 1;
            // Watch for editor changes, to update the markdown view.
            log.debug("adding event listeners for 'editor_text_modified' and 'view_closed'");
            window.addEventListener("editor_text_modified", this.handlers.onmodified);
            window.addEventListener("view_closed", this.handlers.onviewclosed);
        }
        // Create a temporary file.
        var koFileEx = Services.koFileSvc.makeTempFile(".html", "w");
        koFileEx.puts(markdown.toHTML(view.scimoz.text));
        koFileEx.close();
        view.createInternalViewPreview(koFileEx.URI, view.alternateViewList);
        if (orient && ko.views.manager.topView.getAttribute("orient") != orient) {
            ko.views.manager.topView.changeOrient();
        }
        var settings = this.getSettings(view);
        settings.file = koFileEx;
        settings.browserview = view.preview;
        settings.browserview._extension_markdown = { "backRef": view };
        settings.browserview.setAttribute("sub-type", "markdown");
        view.preview = null;
        return settings.browserview;
    }

    this.updatePreview = function(view) {
        var body = view._extension_markdown.browserview.browser.contentDocument.body;
        body.innerHTML = markdown.toHTML(view.scimoz.text);
    }

    /** Event Listeners **/

    this.onkomodostartup = function(event) {
        try {
            this.handlers = {};
            // Store references to bound functions, so can add/remove them.
            this.handlers.onviewchanged = this.onviewchanged.bind(this);
            this.handlers.onviewclosed = this.onviewclosed.bind(this);
            this.handlers.onmodified = this.onmodified.bind(this);

            window.addEventListener("current_view_changed", this.handlers.onviewchanged);

            // Register a preview command.
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
            if (!settings.browserview) {
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
            if (!view || view.getAttribute("type") != "editor" || view.language != "Markdown") {
                this.hidePopup();
                return;
            }
            log.debug("onviewchanged: it's a Markdown file!");
            // Create an object to hold our markdown state information.
            var settings = this.getSettings(view);
            if (!settings.browserview) {
                this.openPopup(view);
            } else {
                this.hidePopup();
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
                    // Closing the browser preview.
                    markdown_browser_count -= 1;
                    if (markdown_browser_count == 0) {
                        // Remove event listeners.
                        log.debug("removing event listeners for 'editor_text_modified' and 'view_closed'");
                        window.removeEventListener("editor_text_modified", this.handlers.onmodified);
                        window.removeEventListener("view_closed", this.handlers.onviewclosed);
                    }
                    delete view._extension_markdown.backRef._extension_markdown;
                } else if (view._extension_markdown.browserview) {
                    log.debug("onviewclosed - closed markdown editor view which has a preview");
                    // Closing the markdown editor file - close the browser view
                    // - it's useless without the accompanying file.
                    // Requires a setTimeout, otherwise errors will ensue.
                    setTimeout(view._extension_markdown.browserview.close.bind(view._extension_markdown.browserview), 1);
                }
                delete view._extension_markdown;
            }
        } catch (ex) {
            log.exception(ex);
        }
    }

    this.onmodified = function(event) {
        try {
            log.debug("onmodified: event");
            var view = event.data.view;
            if (!("_extension_markdown" in view) || !view._extension_markdown.browserview) {
                return;
            }
            log.debug("onmodified: it's a Markdown file!");
            this.updatePreview(view);
        } catch (ex) {
            log.exception(ex);
        }
    }

}).apply(extensions.markdown);

// Event listeners:
//window.addEventListener("load", extensions.markdown.onload.bind(extensions.markdown));
window.addEventListener("komodo-ui-started", extensions.markdown.onkomodostartup.bind(extensions.markdown));
