; Reusable dock workspace. Content is a component, not a hard-coded pane role.
(defn ui/pane [id title options content]
  (map :id id :label title :options options :content content :visible (lookup options :visible true)))

; Paint edges last so pane content cannot erase the shared boundaries.
(defn ui/pane-border [position bounds]
  (let [x (nth position 0) y (nth position 1) w (nth bounds 0) h (nth bounds 1)
        thickness (min 2 w h)]
    (fill (get :ui-pane-border))
    (rect position [w thickness])
    (rect [x (+ y h (- 0 thickness))] [w thickness])
    (rect position [thickness h])
    (rect [(+ x w (- 0 thickness)) y] [thickness h])
    (when (> h 34) (rect [x (+ y 33)] [w 1]))))

(defn ui/dock-header [position bounds handle-width]
  (fill (if (hit? position [handle-width 34]) (get :ui-dock-header-hover) (get :ui-dock-header)))
  (rect position [(nth bounds 0) 34])
  ; A six-dot grip is confined to the draggable title, outside its buttons.
  (when (> handle-width 24)
    (fill (get :ui-muted))
    (repeat 3 row
      (rect [(+ (nth position 0) 10) (+ (nth position 1) 10 (* row 6))] [2 2])
      (rect [(+ (nth position 0) 16) (+ (nth position 1) 10 (* row 6))] [2 2]))))

(defn ui/dockspace [key origin size panes]
  (mapv (fn [entry]
    (let [pane (nth entry 0) position (nth entry 1) bounds (nth entry 2)
          body-origin (nth entry 3) body-size (nth entry 4)
          options (lookup pane :options) id (lookup pane :id) title (lookup pane :label)
          fixed (lookup options :fixed false) collapsed (lookup options :collapsed false)
          minimized (nth entry 5)
          collapse-control (if (lookup options :collapse nil)
            (ui/chevron-button (lookup options :collapse-id) (str (if collapsed "Expand " "Collapse ") title)
              (if collapsed "u" "d") (lookup options :collapse)) nil)
          handle-width (max 0 (- (nth bounds 0) (if (lookup options :collapse nil) 36 0)
            (if (lookup options :hide nil) 36 0)))]
      (scope (clip position bounds)
        (ui-dock-begin key id)
        (ui-region (str "pane-" id) title position bounds true nil true)
        (fill (get :ui-panel)) (rect position bounds)
        (when (and (not fixed) (not minimized)) (ui/dock-header position bounds handle-width))
        (ui/render position [(nth bounds 0) 34]
          (ui/row (map :gap 4 :align "center" :padding [0 0 0 (if (or fixed minimized) 8 28)])
            [(if minimized
               (ui/custom (map :width 20 :height 34) (fn [p s] (asset-icon (lookup options :icon "file") (nth p 0) (+ (nth p 1) 8)))) nil)
             (ui/with (map :grow 1) (if minimized
               (ui/button (str "restore-" id) title (lookup options :collapse)) (ui/label title)))
             collapse-control
             (if (lookup options :hide nil)
               (ui/close-button (lookup options :hide-id) (str "Close " title) (lookup options :hide)) nil)]))
        (when (and (not fixed) (not minimized))
          (ui-dock-handle key id title position [handle-width 34]
            position bounds origin size (lookup options :dock "left") "move"))
        (when (> (nth body-size 1) 0)
          (ui/render body-origin body-size (lookup pane :content)))
        (ui/pane-border position bounds)
        (ui-dock-end))))
    (ui-dock-layout (get key) panes origin size key))
  (ui-dock-resizers key)
  (let [preview (ui-dock-feedback)]
    (when preview
      (let [bounds (lookup preview :rect) origin (slice bounds 0 2) size (slice bounds 2 4)
            progress (lookup preview :progress) ready (lookup preview :ready)
            color (if ready (get :ui-dock-ready) (get :ui-accent))]
        (scope (clip origin size)
          (scope (opacity 0.18) (fill (get :ui-dock-pending)) (rect origin size))
          (scope (opacity 0.35) (fill color) (rect origin [(* (nth size 0) progress) (nth size 1)]))
          (fill (if ready color (get :ui-dock-pending)))
          (rect origin [(nth size 0) 2])
          (rect [(nth origin 0) (+ (nth origin 1) (nth size 1) -2)] [(nth size 0) 2])
          (rect origin [2 (nth size 1)])
          (rect [(+ (nth origin 0) (nth size 0) -2) (nth origin 1)] [2 (nth size 1)])
          (fill (get :ui-text))
          (text [(+ (nth origin 0) 12) (+ (nth origin 1) 12)]
            (if (< (nth size 0) 180) (if ready "Release" "Hold...")
              (if ready "Release to dock" "Hold still to dock"))))))))
