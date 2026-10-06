; Components are rebuilt each frame. Only application state persists.
; Layout is native measurement; painting, behavior and composition stay in Lisp.
(defn ui/row [options children] (map :type "row" :options options :children children))
(defn ui/column [options children] (map :type "column" :options options :children children))
(defn ui/panel [options children] (map :type "panel" :options options :children children))
(defn ui/label [caption] (map :type "label" :label caption))
(defn ui/muted [caption] (map :type "label" :label caption :options (map :tone "muted")))
(defn ui/button [id caption action] (map :type "button" :id id :label caption :action action))
(defn ui/toggle [id caption key] (map :type "toggle" :id id :label caption :key key))
(defn ui/slider [id caption key low high]
  (map :type "slider" :id id :label caption :key key :low low :high high))
(defn ui/scroll [id key options children]
  (init! key 0)
  (map :type "scroll" :id id :key key :options options :children children))
(defn ui/code [tab] (map :type "code" :tab tab))
(defn ui/space [height] (map :type "spacer" :options (map :height height)))
(defn ui/flex [] (map :type "spacer" :options (map :grow 1)))
(defn ui/custom [options paint] (map :type "custom" :options options :paint paint))
(defn ui/chevron-button [id label direction action]
  (assoc (ui/custom (map :width 32 :height 34)
    (fn [origin size]
      (when (ui-chevron-button id label direction origin size) (action)))) :id id))
(defn ui/close-button [id label action]
  (assoc (ui/custom (map :width 32 :height 34)
    (fn [origin size]
      (when (ui-close-button id label origin size) (action)))) :id id))
(defn ui/with [options component]
  (assoc component :options
    (reduce (fn [result key] (assoc result key (lookup options key)))
      (lookup component :options (map)) (keys options))))

(defn ui/paint [component origin size total-height]
  (let [kind (lookup component :type) opts (lookup component :options (map))
        caption (lookup component :label "") id (lookup component :id "")
        disabled (lookup opts :disabled false)]
    (if (= kind "scroll")
      (ui-inspector-scroll id (lookup component :key) (nth origin 0) (nth origin 1) (nth size 0) (nth size 1) total-height)
    (if (= kind "slider")
      (ui-number-slider id caption (lookup component :key) (nth origin 0) (nth origin 1) (nth size 0)
        (lookup component :low) (lookup component :high))
    (if (= kind "panel")
      (do (fill (lookup opts :color (get :ui-panel))) (rect origin size))
      (if (= kind "label")
        (do (fill (if (= (lookup opts :tone "text") "muted") (get :ui-muted) (get :ui-text))) (text origin caption))
        (if (or (= kind "button") (= kind "toggle"))
          (let [active (if (= kind "toggle") (get (lookup component :key)) (lookup opts :active false))
                hovered (and (not disabled) (or (hit? origin size) (focused? id)))]
            (fill (if active (get :ui-accent) (if hovered (get :ui-hover) (get :ui-button)))) (rect origin size)
            (fill (if disabled (get :ui-disabled) (if active (get :ui-active-text) (get :ui-text))))
            (text [(+ (nth origin 0) 12) (+ (nth origin 1) 8)] caption)
            (ui-region id caption origin size (not disabled) active false)
            (when (and (not disabled) (or (activated? id) (and (pointer-pressed?) (hit? origin size))))
              (if (= kind "toggle") (set! (lookup component :key) (not active))
                ((lookup component :action)))))
          (if (= kind "code") (code-editor origin size (lookup component :tab))
            (when (= kind "custom") ((lookup component :paint) origin size))))))))))

(defn ui/render [origin size component]
  (mapv (fn [entry]
    (when (and (> (nth (nth entry 3) 2) 0) (> (nth (nth entry 3) 3) 0))
      (scope (clip (slice (nth entry 3) 0 2) (slice (nth entry 3) 2 4))
        (ui/paint (nth entry 0) (nth entry 1) (nth entry 2) (nth entry 4)))))
    (ui-layout component origin size)))

; A single root bound is enough; children choose their own sizes and spacing.
(defn ui/dialog [id title width height content]
  (let [size [(min width (- (screen-width) 32)) (min height (- (screen-height) 32))]
        origin [(/ (- (screen-width) (nth size 0)) 2) (max 16 (min 80 (- (screen-height) (nth size 1) 16)))]]
    (region id title origin size)
    (ui/render origin size
      (ui/panel (map :padding 16 :gap 16)
        [(ui/row (map :align "center")
          [(ui/with (map :grow 1) (ui/label title))
           (ui/button :close-window "X" (fn [] (set! :window "")))])
         (ui/with (map :grow 1) content)]))))
