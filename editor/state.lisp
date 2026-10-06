; The editor is a fullscreen aioli app: all in one lisp.
; Workspace defaults, preserved through live reload.
(import "./theme.lisp")
(init! :tab "game")
(init! :show-code true)
(init! :show-game true)
(init! :game-collapsed false)
(init! :show-tools false)
(init! :tool "graphics")
(init! :file-context false)
(init! :context-x 8)
(init! :context-y 90)
(init! :context-kind "")
(init! :context-path "")
(init! :file-operation "create")
(init! :menu false)
(init! :paused false)
(init! :window "")
(init! :project-name "Untitled project")
(init! :input-tab "")
(init! :project-settings-error "")
(init! :file-offset 0)
(init! :selected-file "game.lisp")
(init! :show-files false)
(init! :file-path-editing false)
(init! :open-folders [])


; Pan is in screen pixels; zoom multiplies the fitted image size.
(init! :preview-path "")
(init! :preview-zoom 1)
(init! :preview-fit 1)
(init! :preview-pan-x 0)
(init! :preview-pan-y 0)
(init! :preview-drag-x 0)
(init! :preview-drag-y 0)
(init! :preview-drag-pan-x 0)
(init! :preview-drag-pan-y 0)

(init! :inspector-offset 0)
(init! :inspector-edit-key "")

(init! :scene-inspector-offset 0)
(init! :scene-edit-key "")

; Focus mode hides panes without changing their saved visibility or buffers.
(init! :preview-focused false)

(init! :files-collapsed false)

(init! :code-collapsed false)
(init! :inspector-collapsed false)

(init! :project-folders [])
(init! :auto-evaluate true)

(init! :new-file-type "script")
(init! :new-generator-output "image")
(init! :ui-docks (map))
(init! :show-generator false)
(init! :generator-collapsed false)
(init! :show-preview false)
(init! :preview-kind "")
(init! :preview-collapsed false)
(init! :show-project-settings false)
(init! :settings-collapsed false)
(init! :settings-scroll 0)
