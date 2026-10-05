; editor/files-pane.lisp / live Lisp drawing and interaction.
(defn file-explorer [x y w h]
  (let [collapsed (get :files-collapsed)]
  (fill (get :ui-panel)) (rect [x y] [w h])
  (fill (get :ui-border)) (rect [(+ x w -1) y] [1 h])
  (ui-pane-toggle :collapse-files :files-collapsed "Project files" x y w false)
  (if collapsed
    (asset-icon "folder" (+ x 12) (+ y 48))
  (let [tree-height (max (get :ui-file-row-height) (- h 56))
        capacity (min 64 (max 1 (floor (/ tree-height (get :ui-file-row-height)))))
        files (project-tree capacity) rows (min (count files) capacity) total (project-tree-count)
        viewport (- w 28) content (max viewport (project-tree-width))
        horizontal-limit (- content viewport)
        horizontal (scroll-region :files-horizontal-offset [(+ x 8) (+ y h -16)] [viewport 12] :file-scroll-x horizontal-limit)]
    (region :files-tree "Project folder tree" [(+ x 8) (+ y 36)] [(- w 16) tree-height])
    (scope
      (clip [(+ x 8) (+ y 36)] [(- w 16) tree-height])
      (repeat rows i
        (let [file (nth files i) path (nth file 0) folder (= (nth file 1) "folder")
              command (command-file? path) playable (playable-file? path)
              id (str (if folder "folder-" "file-") path)
              indent (* (nth file 4) 14)
              rx (+ x 8 indent (- 0 horizontal)) ry (+ y 36 (* i (get :ui-file-row-height)))
              origin [(+ x 8) ry] size [(- w 24) (- (get :ui-file-row-height) 2)]]
          (fill (if (file-drop-target? path) (get :ui-drop-target)
                  (if (and (not folder) (= (get :selected-file) path)) (get :ui-selection)
                  (if (or (hit? origin size) (focused? id)) (get :ui-hover) (get :ui-panel)))))
          (rect origin size)
          (when folder
            (fill (get :ui-muted))
            (ui-chevron (if (nth file 5) "d" "r") (- rx 1) (+ ry 5) 12))
          (asset-icon (nth file 6) (+ rx 14) (+ ry 5))
          (fill (get :ui-text)) (text [(+ rx (if (or command playable) 58 36)) (+ ry 5)] (nth file 3))
          (resource-region path (nth file 1) (nth file 6) origin size)
          (when (or (activated? id) (and (pointer-pressed?) (hit? origin size)))
            (if folder (toggle-folder path)
              (do (set! :selected-file path) (open-file path))))
          ; This child region takes pointer priority over the file-opening row.
          (when command
            (when (ui-run-button (str "run-" path) (str "Run " path) (+ rx 32) ry)
              (run-command path)))
          (when playable
            (when (ui-run-button (str "play-" path) (str (if (= path "main.lisp") "Restart app / " "Play ") path) (+ rx 32) ry)
              (play-file path)))))
      (when (> total capacity)
        (let [track (* capacity (get :ui-file-row-height)) thumb (max 18 (* track (/ capacity total)))
              offset (project-tree-offset capacity) limit (- total capacity)
              sx (+ x w -14) sy (+ y 36)]
          (fill (get :ui-border)) (rect [sx sy] [3 track])
          (fill (get :ui-muted)) (rect [sx (+ sy (* (- track thumb) (/ offset limit)))] [3 thumb])
          (region :files-scroll "Scroll files" [(- sx 3) sy] [9 track])
          (when (and (pointer-pressed?) (hit? [(- sx 3) sy] [9 track])) (capture! :files-scroll))
          (when (and (or (pointer-down?) (pointer-pressed?)) (captured? :files-scroll))
            (set! :file-offset (round (* limit (clamp (/ (- (pointer-y) sy (/ thumb 2)) (- track thumb)) 0 1))))))))
    (when (> horizontal-limit 0)
      (let [sx (+ x 8) sy (+ y h -16) thumb (max 24 (* viewport (/ viewport content))) travel (- viewport thumb)]
        (fill (get :ui-border)) (rect [sx (+ sy 4)] [viewport 3])
        (fill (get :ui-muted)) (rect [(+ sx (* travel (/ horizontal horizontal-limit))) (+ sy 2)] [thumb 7])
        (region :files-horizontal-scroll "Scroll files horizontally" [sx sy] [viewport 12])
        (when (and (pointer-pressed?) (hit? [sx sy] [viewport 12])) (capture! :files-horizontal-scroll))
        (when (and (or (pointer-down?) (pointer-pressed?)) (captured? :files-horizontal-scroll))
          (set! :file-scroll-x (* horizontal-limit (clamp (/ (- (pointer-x) sx (/ thumb 2)) (max 1 travel)) 0 1))))))))))
