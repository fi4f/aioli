; Filename and starter type are editor conveniences, not runtime roles.
(defn file-type-choice [kind label x y w]
  (when (ui-button (str "file-type-" kind) label [x y] [w 28] (= (get :new-file-type) kind))
    (set! :new-file-type kind)))

(defn file-path-dialog []
  (let [w (min 520 (- (screen-width) 32)) x (/ (- (screen-width) w) 2)
        operation (get :file-operation)
        folder (or (= operation "folder-create") (= operation "folder-rename") (= operation "folder-move"))
        rename (or (= operation "rename") (= operation "folder-rename"))
        move (= operation "folder-move")
        create (and (not folder) (not rename))
        generator (and create (= (get :new-file-type) "generator"))
        h (if create (if generator 324 280) 180)
        y (max 16 (min 90 (- (screen-height) h 16)))
        buttons (if create (if generator 274 230) 128)
        col (/ (- w 44) 3)]
    (fill (get :ui-border)) (rect [(- x 1) (- y 1)] [(+ w 2) (+ h 2)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (region :file-path-panel "Filename dialog" [x y] [w h])
    (fill (get :ui-text)) (text [(+ x 16) (+ y 16)] (if folder (if rename "Rename folder" (if move "Move folder" "New folder")) (if rename "Rename file" "New file")))
    (fill (get :ui-muted)) (text [(+ x 16) (+ y 48)] "Project path / folders separated by /")
    (code-editor [(+ x 16) (+ y 78)] [(- w 32) 28] :__path)
    (when create
      (file-type-choice "none" "None" (+ x 16) (+ y 120) col)
      (file-type-choice "script" "Script" (+ x 22 col) (+ y 120) col)
      (file-type-choice "scene" "Scene" (+ x 28 (* col 2)) (+ y 120) col)
      (file-type-choice "command" "Command" (+ x 16) (+ y 154) col)
      (file-type-choice "generator" "Generator" (+ x 22 col) (+ y 154) col)
      (when generator
        (when (ui-button :generator-output-image "Image" [(+ x 16) (+ y 194)] [col 28] (= (get :new-generator-output) "image")) (set! :new-generator-output "image"))
        (when (ui-button :generator-output-audio "Audio" [(+ x 22 col) (+ y 194)] [col 28] (= (get :new-generator-output) "audio")) (set! :new-generator-output "audio"))
        (when (ui-button :generator-output-text "Text" [(+ x 28 (* col 2)) (+ y 194)] [col 28] (= (get :new-generator-output) "text")) (set! :new-generator-output "text")))
      (scope
        (clip [(+ x 16) (+ y buttons -32)] [(- w 32) 24])
        (fill (get :ui-muted))
        (text [(+ x 16) (+ y buttons -28)] (new-file-path (path-input) (get :new-file-type)))))
    (when (ui-button (if folder :folder-apply (if rename :file-rename :file-create)) (if rename "Rename" (if move "Move" "Create")) [(+ x 16) (+ y buttons)] [96 32] false)
      (if folder (apply-folder-path (path-input))
        (if rename (rename-file (get :selected-file) (path-input))
          (create-file (new-file-path (path-input) (get :new-file-type)) (new-file-code (get :new-file-type) (get :new-generator-output))))))
    (when (ui-button :close-window "Cancel" [(+ x 124) (+ y buttons)] [96 32] false) (set! :window ""))))
