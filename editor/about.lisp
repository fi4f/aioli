; editor/about.lisp / live Lisp drawing and interaction.
(defn about-aioli []
  (let [w (min 400 (- (screen-width) 32)) x (/ (- (screen-width) w) 2) y 80]
    (fill (get :ui-border)) (rect [(- x 1) (- y 1)] [(+ w 2) 242])
    (fill (get :ui-panel)) (rect [x y] [w 240])
    (region :about-panel "About aioli" [x y] [w 240])
    (scope (clip [x y] [w 240])
      (fill (get :ui-text)) (text [(+ x 20) (+ y 20)] "aioli / 0.1")
      (fill (get :ui-muted))
      (text [(+ x 20) (+ y 60)] "all in one lisp")
      (text [(+ x 20) (+ y 96)] "A live pixel-first game workshop.")
      (text [(+ x 20) (+ y 124)] "The editor itself is Lisp.")
      (when (ui-close-button :close-window "Close About" [(+ x w -40) (+ y 8)] [32 32]) (set! :window "")))))
