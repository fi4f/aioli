; editor/menu-bar.lisp / live Lisp drawing and interaction.
(defn menu-title [id caption x width]
  (when (ui-button id caption [x 8] [width 32] (= (get :menu) id))
    (set! :file-context false) (set! :context-kind "")
    (set! :menu (if (= (get :menu) id) false id)))
  (when (and (get :menu) (pointer-moved?) (not (= (get :menu) id)) (hit? [x 8] [width 32]))
    (set! :menu id)))

(defn editor-menu-bar []
  (menu-title :file "File" 8 48)
  (menu-title :project "Project" 56 80)
  (menu-title :view "View" 136 56)
  (menu-title :edit "Edit" 192 56)
  (menu-title :about "About" 248 72))

; Visibility toggles, layout actions, tools, then recovery.
(defn editor-view-menu [x y width w]
  (when (menu-action :files "Files pane" "" x (+ y 4) width true (get :show-files))
    (set! :show-files (not (get :show-files))) (set! :file-path-editing false))
  (when (menu-action :code "Code pane" "" x (+ y 34) width true
          (and (get :show-code) (or (>= w (get :ui-narrow-width)) (not (get :show-files)))))
    (set! :show-code (if (and (< w (get :ui-narrow-width)) (get :show-files)) true (not (get :show-code))))
    (when (< w (get :ui-narrow-width)) (set! :show-files false)))
  (when (menu-action :game-view "Game view" "" x (+ y 64) width true (get :show-game))
    (set! :show-game (not (get :show-game))) (set! :preview-focused false)
    (when (and (< w (get :ui-narrow-width)) (get :show-game))
      (set! :show-code false) (set! :show-files false)))
  (when (menu-action :tools "Scene inspector" "" x (+ y 94) width true (get :show-tools))
    (set! :show-tools (not (get :show-tools))))
  (when (menu-action :generators "Generator inspector" "" x (+ y 124) width true (get :show-generator))
    (if (get :show-generator) (close-generator) (open-generator (generator-path))))
  (menu-divider x (+ y 159) width)
  (when (menu-action :focus-preview-menu (if (get :preview-focused) "Restore editor" "Focus preview") "F4"
          x (+ y 164) width true (get :preview-focused)) (toggle-preview-focus))
  (when (menu-action :reset-pane-layout "Reset pane layout" "" x (+ y 194) width true nil) (set! :ui-docks (map)))
  (menu-divider x (+ y 229) width)
  (when (menu-action :commands "Command palette" "Ctrl+Shift+P" x (+ y 234) width true nil) (set! :window "palette"))
  (when (menu-action :wgsl "Compiled WGSL" "" x (+ y 264) width true nil)
    (set! :tab "wgsl") (set! :show-code true) (set! :show-files false))
  (menu-divider x (+ y 299) width)
  (when (menu-action :recovery-shell "Recovery shell" "F2" x (+ y 304) width true nil) (open-recovery))
  (when (recovery?)
    (when (menu-action :leave-recovery "Project editor" "" x (+ y 334) width true nil) (leave-recovery))))

(defn editor-menu [w h]
  (let [kind (get :menu) width (min 312 (- w 16))
        anchor (if (= kind "file") 8 (if (= kind "project") 56 (if (= kind "view") 136 (if (= kind "edit") 192 248))))
        x (min anchor (- w width 8)) y 52
        height (if (= kind "file") 384 (if (= kind "project") (if (recovery?) 204 164) (if (= kind "view") (if (recovery?) 374 344) (if (= kind "edit") 204 102))))]
    ; A background region dismisses the menu without also activating a pane.
    (region :menu-dismiss "Close menu" [0 50] [w (- h 80)])
    (when (and (pointer-pressed?) (hit? [0 50] [w (- h 80)])) (set! :menu false))
    (fill (get :ui-border)) (rect [(- x 1) (- y 1)] [(+ width 2) (+ height 2)])
    (fill (get :ui-panel)) (rect [x y] [width height])
    (region :menu-panel "Menu" [x y] [width height])
    (scope
      (clip [x y] [width height])
      (if (= kind "file")
        (do
          (when (menu-action :new-project "New project" "" x (+ y 4) width true nil) (new-project))
          (when (menu-action :import "Open project..." "Ctrl+O" x (+ y 34) width true nil) (import-project))
          (when (menu-action :export "Save project..." "Ctrl+S" x (+ y 64) width true nil) (export-project))
          (menu-divider x (+ y 99) width)
          (when (menu-action :new-file "New file..." "" x (+ y 104) width true nil) (prepare-file-path))
          (when (menu-action :open-file "Open file..." "" x (+ y 134) width true nil) (open-external-file))
          (when (menu-action :save-file "Save file..." "" x (+ y 164) width (save-file?) nil) (save-file))
          (when (menu-action :import-resource "Import resource..." "" x (+ y 194) width true nil) (import-resource))
          (when (menu-action :download-selected "Download selected file" "" x (+ y 224) width (selected-file?) nil) (download-resource (get :selected-file)))
          (when (menu-action :rename-file "Rename file..." "" x (+ y 254) width (selected-file-renamable?) nil) (prepare-file-path true))
          (when (menu-action :delete-file "Delete file" "" x (+ y 284) width (selected-file-removable?) nil) (delete-file (get :selected-file)))
          (when (menu-action :png "Export game PNG" "" x (+ y 314) width true nil) (export-png))
          (when (menu-action :export-html "Export application HTML" "" x (+ y 344) width true nil) (export-html)))
        (if (= kind "project")
          (do
            (when (menu-action :evaluate "Run / Evaluate" "Ctrl+Enter" x (+ y 4) width true nil) (evaluate-project))
            (when (menu-action :pause (if (get :paused) "Play" "Pause") "" x (+ y 34) width true nil) (set! :paused (not (get :paused))))
            (when (menu-action :reset "Reset state" "" x (+ y 64) width true nil) (reset-project))
            (when (menu-action :auto-evaluate "Automatic re-evaluation" "" x (+ y 94) width true (get :auto-evaluate)) (toggle-auto-evaluate))
            (when (menu-action :canvas-settings "Canvas size..." "" x (+ y 124) width true nil) (open-canvas-settings))
            (when (recovery?)
              (when (menu-action :upgrade-editor "Use latest editor" "" x (+ y 164) width true nil) (upgrade-editor))))
          (if (= kind "view")
            (editor-view-menu x y width w)
            (if (= kind "edit")
              (do
                (when (menu-action :undo "Undo" "Ctrl+Z" x (+ y 4) width (can-edit-buffer? :undo) nil) (edit-buffer :undo))
                (when (menu-action :redo "Redo" "Ctrl+Y" x (+ y 34) width (can-edit-buffer? :redo) nil) (edit-buffer :redo))
                (menu-divider x (+ y 69) width)
                (when (menu-action :cut "Cut" "Ctrl+X" x (+ y 74) width (can-edit-buffer? :cut) nil) (edit-buffer :cut))
                (when (menu-action :copy "Copy" "Ctrl+C" x (+ y 104) width (can-edit-buffer? :copy) nil) (edit-buffer :copy))
                (when (menu-action :paste "Paste" "Ctrl+V" x (+ y 134) width (can-edit-buffer? :paste) nil) (edit-buffer :paste))
                (when (menu-action :select-all "Select all" "Ctrl+A" x (+ y 164) width (can-edit-buffer? :select-all) nil) (edit-buffer :select-all)))
              (do
                (when (menu-action :about-aioli "About aioli" "" x (+ y 4) width true nil) (set! :window "about"))
                (when (menu-action :docs "Documentation" "" x (+ y 34) width true nil) (open-docs))
                (when (menu-action :help "Language guide" "" x (+ y 64) width true nil) (set! :tab "guide") (set! :show-code true) (set! :show-files false))))))))))
