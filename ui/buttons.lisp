; ui/buttons.lisp / live Lisp drawing and interaction.
(defn ui-button [id caption origin size active]
  (scope
    (fill (if active (get :ui-accent)
              (if (or (hit? origin size) (focused? id)) "#252e29" "#191f1b")))
    (rect origin size)
    (fill (if active "#162019" (get :ui-text)))
    (text [(+ (nth origin 0) 12) (+ (nth origin 1) 8)] caption))
  (region id caption origin size)
  (or (and (pointer-pressed?) (hit? origin size)) (activated? id)))

(defn ui-tab [id caption x active]
  (when (ui-button (str "tab-" id) caption [x 58] [70 32]
                   (= active id))
    (set! :tab id)))
