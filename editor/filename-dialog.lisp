; editor/filename-dialog.lisp / live Lisp drawing and interaction.
(defn file-path-dialog []
  (let [w (min 440 (- (screen-width) 32)) x (/ (- (screen-width) w) 2) y 90
        rename (= (get :file-operation) "rename")]
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ w 2) 182])
    (fill (get :ui-panel)) (rect [x y] [w 180])
    (region :file-path-panel "Filename dialog" [x y] [w 180])
    (fill (get :ui-text)) (text [(+ x 16) (+ y 16)] (if rename "Rename file" "New Lisp file"))
    (fill (get :ui-muted)) (text [(+ x 16) (+ y 48)] "Project path / folders separated by /")
    (code-editor [(+ x 16) (+ y 78)] [(- w 32) 28] :__path)
    (when (ui-button (if rename :file-rename :file-create) (if rename "Rename" "Create") [(+ x 16) (+ y 128)] [96 32] false)
      (if rename (rename-file (get :selected-file) (path-input)) (create-file (path-input))))
    (when (ui-button :close-window "Cancel" [(+ x 124) (+ y 128)] [96 32] false) (set! :window ""))))
