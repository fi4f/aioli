; Dock trees are immutable application data, not host objects.
(defn dock-leaves [tree]
  (if (= tree nil) [] (if (string? tree) [tree]
    (concat (dock-leaves (lookup tree :first)) (dock-leaves (lookup tree :second))))))
(defn dock-remove [tree id]
  (if (or (= tree nil) (string? tree)) (if (= tree id) nil tree)
    (let [first (dock-remove (lookup tree :first) id) second (dock-remove (lookup tree :second) id)]
      (if (= first nil) second (if (= second nil) first (merge tree (map :first first :second second)))))))
(defn dock-join [tree id edge fraction]
  (if (= tree nil) id
    (let [before (contains? ["left" "top"] edge)]
      (map :axis (if (contains? ["left" "right"] edge) "x" "y")
        :ratio (if before fraction (- 1 fraction)) :first (if before id tree) :second (if before tree id)))))
(defn dock-split [tree target id edge]
  (if (= tree nil) id
    (if (string? tree) (if (= tree target) (dock-join tree id edge 0.5) tree)
      (merge tree (map :first (dock-split (lookup tree :first) target id edge)
                       :second (dock-split (lookup tree :second) target id edge))))))
(defn dock-ratio [tree path ratio]
  (if (= (count path) 0) (assoc tree :ratio ratio)
    (let [side (if (= (nth path 0) 0) "first" "second")]
      (assoc tree side (dock-ratio (lookup tree side) (slice path 1) ratio)))))
(defn dock-highest-z [placements]
  (reduce (fn [highest pane] (max highest (lookup pane :z 0))) 0 (values placements)))
(defn dock-promote [placements id]
  (assoc placements id (assoc (lookup placements id) :z (+ 1 (dock-highest-z placements)))))
(defn dock-hover [hover candidate point now dwell tolerance]
  (if (= candidate nil) (map :hover nil :preview nil)
    (let [key (str (lookup candidate :target "workspace") ":" (lookup candidate :edge)) rect (lookup candidate :rect)
          moved (or (= hover nil) (not (= (lookup hover :key) key))
            (> (reduce (fn [largest i] (max largest (abs (- (nth rect i) (lookup (lookup hover :rect []) i 0))))) 0 (range 4)) 0.5)
            (> (+ (* (- (nth point 0) (lookup hover :x 0)) (- (nth point 0) (lookup hover :x 0)))
                  (* (- (nth point 1) (lookup hover :y 0)) (- (nth point 1) (lookup hover :y 0)))) (* tolerance tolerance)))
          next (if moved (map :key key :x (nth point 0) :y (nth point 1) :rect rect :since now) hover)
          progress (if (> dwell 0) (clamp (/ (- now (lookup next :since)) dwell) 0 1) 1)]
      (map :hover next :preview (merge candidate (map :progress progress :ready (= progress 1)))))))
(defn dock-drop [placements tree id preview]
  (let [remaining (dock-remove tree id) target (lookup preview :target) edge (lookup preview :edge)
        next (assoc placements id (if (= target nil) (map :dock edge :extent 0.3) (map :dock "split" :target target)))]
    (if (or (not (= target nil)) (contains? placements :_tree))
      (assoc next :_tree (if (= target nil) (dock-join remaining id edge 0.3) (dock-split remaining target id edge))) next)))

(defn dock-complete [tree panes placements size]
  (reduce (fn [next pane]
    (let [id (lookup pane :id) opts (lookup pane :options (map))
          edge (lookup (lookup placements id) :dock (lookup opts :dock "right"))]
      (if (or (= pane nil) (= (lookup pane :visible true) false)
              (and (not (lookup opts :fixed false)) (= edge "floating")) (contains? (dock-leaves next) id)) next
        (let [axis (if (contains? ["top" "bottom"] edge) 1 0) extent (lookup opts :extent 0.3)
              fraction (if (<= extent 1) extent (/ extent (max 1 (nth size axis))))]
          (dock-join next id (if (contains? ["left" "right" "top" "bottom"] edge) edge "right") (clamp fraction 0.1 0.8)))))) tree panes))

; Drag geometry is evaluated only during interaction, not for every painted component.
(defn dock-floating [before region start point placements]
  (let [rect (lookup region :dockRect) area (lookup region :dockWorkspace)
        px (nth rect 0) py (nth rect 1) w (nth rect 2) h (nth rect 3)
        wx (nth area 0) wy (nth area 1) ww (nth area 2) wh (nth area 3)
        detach (not (= (lookup before :dock) "floating"))
        width (if detach (min (max 120 (* w 0.9)) (max 0 (- ww 32))) (min w ww))
        height (if detach (min (max 80 (* h 0.9)) (max 0 (- wh 32))) (min h wh))
        ix (if detach (min 16 (/ (- ww width) 2)) 0) iy (if detach (min 16 (/ (- wh height) 2)) 0)]
    (merge before (map :dock "floating" :z (if detach (+ 1 (dock-highest-z placements)) (lookup before :z 0))
      :x (clamp (if detach (- (nth point 0) (/ (* (- (nth start 0) px) width) w)) (+ px (- (nth point 0) (nth start 0))))
           (+ wx ix) (- (+ wx ww) width ix))
      :y (clamp (+ py (- (nth point 1) (nth start 1))) (+ wy iy) (- (+ wy wh) height iy)) :width width :height height))))
(defn dock-resize [before region start point]
  (let [rect (lookup region :dockRect) area (lookup region :dockWorkspace) kind (lookup region :dockKind)
        px (nth rect 0) py (nth rect 1) w (nth rect 2) h (nth rect 3)
        wx (nth area 0) wy (nth area 1) ww (nth area 2) wh (nth area 3)
        dx (- (nth point 0) (nth start 0)) dy (- (nth point 1) (nth start 1))
        dock (lookup before :dock (lookup region :dockDefault))]
    (if (= dock "floating")
      (let [min-height (if (<= h 34) h 80)
            left (if (= kind "resize-left") (clamp (+ px dx) wx (- (+ px w) (min 120 w))) px)
            top (if (= kind "resize-top") (clamp (+ py dy) wy (- (+ py h) (min min-height h))) py)
            right (if (contains? ["resize-right" "resize"] kind) (clamp (+ px w dx) (+ left (min 120 w)) (+ wx ww)) (+ px w))
            bottom (if (contains? ["resize-bottom" "resize"] kind) (clamp (+ py h dy) (+ top (min min-height h)) (+ wy wh)) (+ py h))]
        (merge before (map :x left :y top :width (- right left) :height (if (<= h 34) (lookup before :height h) (- bottom top)))))
      (let [vertical (contains? ["top" "bottom"] dock) sign (if (contains? ["right" "bottom"] dock) -1 1)]
        (merge before (map :dock dock :extent (max 120 (+ (if vertical h w) (* sign (if vertical dy dx))))))))))
(defn dock-workspace-preview [point area]
  (let [x (nth point 0) y (nth point 1) wx (nth area 0) wy (nth area 1) w (nth area 2) h (nth area 3)
        distances [(- x wx) (- (+ wx w) x) (- y wy) (- (+ wy h) y)]
        distance (reduce min 1000000 distances)]
    (if (or (< x wx) (< y wy) (> x (+ wx w)) (> y (+ wy h)) (> distance 64)) nil
      (let [edge (nth ["left" "right" "top" "bottom"] (index-of distances distance))]
        (map :edge edge :rect
          (if (= edge "left") [wx wy (* w 0.3) h]
          (if (= edge "right") [(+ wx (* w 0.7)) wy (* w 0.3) h]
          (if (= edge "top") [wx wy w (* h 0.3)] [wx (+ wy (* h 0.7)) w (* h 0.3)]))))))))
(defn dock-point-inside? [point position size]
  (and (>= (nth point 0) (nth position 0)) (>= (nth point 1) (nth position 1))
       (< (nth point 0) (+ (nth position 0) (nth size 0))) (< (nth point 1) (+ (nth position 1) (nth size 1)))))
(defn dock-pane-preview [id point area entries placements]
  (let [x (nth point 0) y (nth point 1) wx (nth area 0) wy (nth area 1) w (nth area 2) h (nth area 3)
        distance (min (- x wx) (- (+ wx w) x) (- y wy) (- (+ wy h) y))]
    (if (and (> distance 20) (dock-point-inside? point (slice area 0 2) (slice area 2)))
      (let [matches (filter (fn [entry] (let [pane (nth entry 0)]
            (and (not (= (lookup pane :id) id)) (not (lookup (lookup pane :options) :collapsed false))
                 (not (= (lookup (lookup placements (lookup pane :id)) :dock) "floating"))
                 (dock-point-inside? point (nth entry 1) (nth entry 2))))) entries)
            entry (lookup matches (- (count matches) 1))]
        (if (= entry nil) nil
          (let [pane (nth entry 0) p (nth entry 1) size (nth entry 2)
                distances [(/ (- x (nth p 0)) (nth size 0)) (/ (- (+ (nth p 0) (nth size 0)) x) (nth size 0))
                           (/ (- y (nth p 1)) (nth size 1)) (/ (- (+ (nth p 1) (nth size 1)) y) (nth size 1))]
                nearest (reduce min 1000000 distances) edge (nth ["left" "right" "top" "bottom"] (index-of distances nearest))
                axis (if (contains? ["left" "right"] edge) 0 1)]
            (if (and (<= nearest 0.4) (>= (nth size axis) (if (= axis 0) 240 160)))
              (map :edge edge :target (lookup pane :id) :rect
                [(+ (nth p 0) (if (= edge "right") (/ (nth size 0) 2) 0))
                 (+ (nth p 1) (if (= edge "bottom") (/ (nth size 1) 2) 0))
                 (if (= axis 0) (/ (nth size 0) 2) (nth size 0)) (if (= axis 1) (/ (nth size 1) 2) (nth size 1))]) nil))))
      (dock-workspace-preview point area))))
