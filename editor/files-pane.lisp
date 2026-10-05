; editor/files-pane.lisp / live Lisp drawing and interaction.
(defn file-explorer [x y w h]
  (fill (get :ui-panel)) (rect [x y] [w h])
  (fill "#27312a") (rect [(+ x w -1) y] [1 h])
  (fill (get :ui-text)) (text [(+ x 16) (+ y 12)] "Project files")
  (when (ui-button :hide-files "x" [(+ x w -40) (+ y 4)] [32 28] false)
    (set! :show-files false))
  (let [files (project-tree) tree-height (max 26 (- h 44))
        capacity (min 64 (max 1 (floor (/ tree-height 26))))
        rows (min (count files) capacity) total (project-tree-count)]
    (region :files-tree "Project folder tree" [(+ x 8) (+ y 36)] [(- w 16) tree-height])
    (scope
      (clip [(+ x 8) (+ y 36)] [(- w 16) tree-height])
      (repeat rows i
        (let [file (nth files i) path (nth file 0) folder (= (nth file 1) "folder")
              id (str (if folder "folder-" "file-") path)
              indent (min (* (nth file 4) 14) (- w 100))
              rx (+ x 8 indent) ry (+ y 36 (* i 26))
              origin [(+ x 8) ry] size [(- w 24) 24]]
          (fill (if (and (not folder) (= (get :selected-file) path)) "#344339"
                  (if (or (hit? origin size) (focused? id)) "#252e29" (get :ui-panel))))
          (rect origin size)
          (when folder
            (fill (get :ui-muted))
            (if (nth file 5)
              (do (line [rx (+ ry 9)] [(+ rx 4) (+ ry 13)] 1)
                  (line [(+ rx 4) (+ ry 13)] [(+ rx 8) (+ ry 9)] 1))
              (do (line [(+ rx 2) (+ ry 7)] [(+ rx 6) (+ ry 11)] 1)
                  (line [(+ rx 6) (+ ry 11)] [(+ rx 2) (+ ry 15)] 1))))
          (asset-icon (nth file 6) (+ rx 14) (+ ry 5))
          (fill (get :ui-text)) (text [(+ rx 36) (+ ry 5)] (nth file 3))
          (resource-region path (nth file 1) (nth file 6) origin size)
          (when (or (activated? id) (and (pointer-pressed?) (hit? origin size)))
            (if folder (toggle-folder path)
              (do (set! :selected-file path) (open-file path))))))
      (when (> total capacity)
        (let [track (* capacity 26) thumb (max 18 (* track (/ capacity total)))
              offset (project-tree-offset) limit (- total capacity)
              sx (+ x w -8) sy (+ y 36)]
          (fill "#27312a") (rect [sx sy] [3 track])
          (fill (get :ui-muted)) (rect [sx (+ sy (* (- track thumb) (/ offset limit)))] [3 thumb])
          (region :files-scroll "Scroll files" [(- sx 3) sy] [9 track])
          (when (and (pointer-pressed?) (hit? [(- sx 3) sy] [9 track])) (capture! :files-scroll))
          (when (and (pointer-down?) (captured? :files-scroll))
            (set! :file-offset (round (* limit (clamp (/ (- (pointer-y) sy (/ thumb 2)) (- track thumb)) 0 1))))))))))
