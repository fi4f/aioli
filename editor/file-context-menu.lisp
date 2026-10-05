; editor/file-context-menu.lisp / live Lisp drawing and interaction.
(defn file-context-menu [w h]
  (let [width (min 260 (- w 16)) height 194
        x (clamp (get :context-x) 8 (- w width 8)) y (clamp (get :context-y) 52 (- h height 32))
        leaf (= (get :context-kind) "file")]
    (region :context-dismiss "Close file menu" [0 50] [w (- h 80)])
    (when (pointer-pressed?) (set! :file-context false))
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ width 2) (+ height 2)])
    (fill (get :ui-panel)) (rect [x y] [width height])
    (region :context-panel "File actions" [x y] [width height])
    (when (menu-action :context-new "New file..." "" x (+ y 4) width true nil) (prepare-file-path))
    (when (menu-action :context-import "Import resource..." "" x (+ y 34) width true nil) (import-resource))
    (menu-divider x (+ y 69) width)
    (when (menu-action :context-open "Open" "" x (+ y 74) width leaf nil) (open-file (get :selected-file)))
    (when (menu-action :context-download "Download" "" x (+ y 104) width leaf nil) (download-resource (get :selected-file)))
    (when (menu-action :context-rename "Rename..." "" x (+ y 134) width (and leaf (selected-file-removable?)) nil) (prepare-file-path true))
    (when (menu-action :context-delete "Delete" "" x (+ y 164) width (and leaf (selected-file-removable?)) nil) (delete-file (get :selected-file)))))
