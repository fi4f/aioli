(defn command-palette [x y w h]
  (ui/render [(+ x 16) y] [(- w 32) h]
    (ui/column (map :gap 12)
      [(ui/muted "Search commands, or type Lisp and run")
       (ui/with (map :height 100) (ui/code :__palette))
       (ui/row (map :align "center")
         [(ui/button :run-instruction "Run Lisp" (fn [] (run-instruction)))
          (ui/muted "Ctrl+Enter")])
       (ui/scroll :palette-list-scroll :palette-list-offset (map :gap 6 :grow 1)
         (mapv (fn [path] (ui/button (str "command-" path) path (fn [] (run-command path))))
           (palette-commands)))])))
