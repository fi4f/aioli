; File actions target the resource clicked, including a command's run button.
(defn file-context-menu [w h]
  (let [width (min 260 (- w 16))
        leaf (= (get :context-kind) "file")
        folder (= (get :context-kind) "folder")
        command (and leaf (command-file? (get :context-path)))
        height (if leaf (if command 254 224) (if folder 194 104))
        x (clamp (get :context-x) 8 (- w width 8))
        y (clamp (get :context-y) 52 (- h height 32))]
    (region :context-dismiss "Close file menu" [0 50] [w (- h 80)])
    (when (and (pointer-pressed?) (hit? [0 50] [w (- h 80)])) (set! :file-context false))
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ width 2) (+ height 2)])
    (fill (get :ui-panel)) (rect [x y] [width height])
    (region :context-panel "File actions" [x y] [width height])
    (when (menu-action :context-new "New file..." "" x (+ y 4) width true nil) (prepare-file-path))
    (when (menu-action :context-new-folder "New folder..." "" x (+ y 34) width true nil) (prepare-folder-path))
    (when (menu-action :context-import "Import resource..." "" x (+ y 64) width true nil) (import-resource))
    (when leaf
      (menu-divider x (+ y 99) width)
      (when (menu-action :context-open "Open" "" x (+ y 104) width true nil) (open-file (get :context-path)))
      (when (menu-action :context-download "Download" "" x (+ y 134) width true nil) (download-resource (get :context-path)))
      (when (menu-action :context-rename "Rename..." "" x (+ y 164) width (selected-file-renamable?) nil) (prepare-file-path true))
      (when (menu-action :context-delete "Delete" "" x (+ y 194) width (selected-file-removable?) nil) (delete-file (get :context-path)))
      (when command
        (when (menu-action :context-run "Run command" "" x (+ y 224) width true nil) (run-command (get :context-path)))))
    (when folder
      (menu-divider x (+ y 99) width)
      (when (menu-action :context-folder-rename "Rename folder..." "" x (+ y 104) width true nil) (prepare-folder-path "rename"))
      (when (menu-action :context-folder-move "Move folder..." "" x (+ y 134) width true nil) (prepare-folder-path "move"))
      (when (menu-action :context-folder-delete (str "Delete folder (" (folder-file-count (get :context-path)) " files)") "" x (+ y 164) width true nil)
        (delete-folder (get :context-path))))))
