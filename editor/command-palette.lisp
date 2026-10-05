; editor/command-palette.lisp / live Lisp drawing and interaction.
(defn command-palette [x y w h]
  (fill (get :ui-muted)) (text [(+ x 16) y] "Search commands, or type Lisp and run")
  (code-editor [(+ x 16) (+ y 28)] [(- w 32) 100] :__palette)
  (when (ui-button :run-instruction "Run Lisp" [(+ x 16) (+ y 140)] [110 32] false) (run-instruction))
  (fill (get :ui-muted)) (text [(+ x 140) (+ y 148)] "Ctrl+Enter")
  (let [commands (palette-commands)]
    (repeat (min (count commands) (max 0 (floor (/ (- h 206) 38)))) i
      (let [path (nth commands i)]
        (when (ui-button (str "command-" path) path [(+ x 16) (+ y 192 (* i 38))] [(- w 32) 32] false)
          (run-command path))))))
