; Monokai-inspired editor theme. This is an ordinary imported project file.
; set! deliberately reapplies constants on every evaluation: edit here, then
; Ctrl+Enter (or automatic evaluation) updates an existing saved project too.
; Workspace/game state stays in its own files. Access constants with (get :ui-...).

; Surfaces, text and interaction states.
(set! :ui-bg "#1e1f1c")
(set! :ui-panel "#272822")
(set! :ui-text "#f8f8f2")
(set! :ui-muted "#a6a69c")
(set! :ui-accent "#66d9ef")
(set! :ui-border "#45463f")
(set! :ui-pane-border "#65685e")
(set! :ui-dock-header "#34382f")
(set! :ui-dock-header-hover "#454c3d")
(set! :ui-dock-pending "#c0c4bb")
(set! :ui-dock-ready "#a6e22e")
(set! :ui-hover "#383a32")
(set! :ui-button "#30312b")
(set! :ui-active-text "#1e1f1c")
(set! :ui-selection "#49483e")
(set! :ui-drop-target "#50415d")
(set! :ui-shadow "#151612")
(set! :ui-disabled "#75766b")
(set! :ui-slider-track "#45463f")
(set! :ui-error "#f92672")
(set! :ui-playhead "#fd971f")
(set! :ui-checker-light "#3b3c35")
(set! :ui-checker-dark "#30312b")
(set! :ui-hook-hover "#3b3d35")
(set! :ui-hook-bg "#30312b")
(set! :ui-line-number "#75766b")

; Syntax colors. Bitmap glyphs remain the engine's fixed 8 x 18 cells.
(set! :ui-syntax-comment "#898a7b")
(set! :ui-syntax-string "#e6db74")
(set! :ui-syntax-keyword "#f92672")
(set! :ui-syntax-number "#ae81ff")
(set! :ui-syntax-delimiter "#a6a69c")

; Shared layout metrics (logical pixels, independent of display density).
; Keep pane widths >= 240, collapsed width >= 40, row height >= 24,
; field height >= 48, code line height >= 20 and code gutter >= 24.
; Icon size 16-20 fits the file rows; code fraction is between 0 and 1.
(set! :ui-files-width 280)
(set! :ui-inspector-width 264)
(set! :ui-collapsed-width 40)
(set! :ui-code-fraction 0.42)
(set! :ui-narrow-width 850)
(set! :ui-icon-size 16)
(set! :ui-file-row-height 26)
(set! :ui-field-height 56)
(set! :ui-code-line-height 21)
(set! :ui-code-gutter 40)
