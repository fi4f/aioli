(defn about-aioli []
  (ui/dialog :about-panel "aioli / 0.1" 400 240
    (ui/column (map :gap 18)
      [(ui/muted "all in one lisp")
       (ui/label "A live pixel-first game workshop.")
       (ui/label "The editor itself is Lisp.")])))
