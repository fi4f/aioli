; Preview bodies receive their bounds from the dock host. The browser decodes assets.
(defn image-asset-canvas [origin size]
  (let [x (nth origin 0) y (nth origin 1) w (max 1 (nth size 0)) h (max 1 (nth size 1))
        fit (min 1 (/ w (max 1 (asset-width))) (/ h (max 1 (asset-height))))]
    (set! :preview-fit fit)
    (repeat 12 i (repeat 8 j
      (fill (if (= (mod (+ i j) 2) 0) (get :ui-checker-dark) (get :ui-checker-light)))
      (rect [(+ x (* i (/ w 12))) (+ y (* j (/ h 8)))] [(/ w 12) (/ h 8)])))
    (region :asset-image-area "Image / drag to pan, wheel to zoom" origin size)
    (when (and (pointer-pressed?) (hit? origin size))
      (capture! :asset-image-area)
      (set! :preview-drag-x (pointer-x)) (set! :preview-drag-y (pointer-y))
      (set! :preview-drag-pan-x (get :preview-pan-x)) (set! :preview-drag-pan-y (get :preview-pan-y)))
    (when (and (pointer-down?) (captured? :asset-image-area))
      (set! :preview-pan-x (+ (get :preview-drag-pan-x) (- (pointer-x) (get :preview-drag-x))))
      (set! :preview-pan-y (+ (get :preview-drag-pan-y) (- (pointer-y) (get :preview-drag-y)))))
    (let [iw (* (asset-width) fit (get :preview-zoom)) ih (* (asset-height) fit (get :preview-zoom))]
      (asset-image [(+ x (/ (- w iw) 2) (get :preview-pan-x))
                    (+ y (/ (- h ih) 2) (get :preview-pan-y))] [iw ih]))))

(defn image-size-reset [actual]
  (let [fit (get :preview-fit)]
    (set! :preview-zoom (if actual (/ 1 (max 0.0001 fit)) 1))
    (set! :preview-pan-x 0) (set! :preview-pan-y 0)))
(defn image-asset-content [origin size]
  (ui/render origin size
    (ui/column (map :padding 12 :gap 8)
      [(ui/custom (map :grow 1) image-asset-canvas)
       (ui/row (map :gap 6)
         [(ui/button :asset-zoom-out "-" (fn [] (set! :preview-zoom (max 0.1 (/ (get :preview-zoom) 1.25)))))
          (ui/button :asset-zoom-in "+" (fn [] (set! :preview-zoom (min (/ 32 (max 0.0001 (get :preview-fit))) (* (get :preview-zoom) 1.25)))))])
       (ui/row (map :gap 6)
         [(ui/button :asset-fit "Fit" (fn [] (image-size-reset false)))
          (ui/button :asset-actual-size "1:1" (fn [] (image-size-reset true)))])])))

(defn audio-asset-wave [origin size]
  (let [x (nth origin 0) y (nth origin 1) w (max 1 (nth size 0)) h (max 1 (nth size 1))
        duration (max 0.001 (asset-duration))]
    (fill (get :ui-bg)) (rect origin size)
    (fill (get :ui-selection)) (rect [x (+ y (/ h 2))] [w 1])
    (fill (get :ui-accent)) (asset-waveform origin size)
    (fill (get :ui-playhead)) (rect [(+ x (* w (/ (asset-time) duration))) y] [1 h])
    (region :asset-seek "Audio / click or drag to seek" origin size)
    (when (and (pointer-pressed?) (hit? origin size)) (capture! :asset-seek))
    (when (and (or (pointer-down?) (pointer-pressed?)) (captured? :asset-seek))
      (seek-asset (* duration (clamp (/ (- (pointer-x) x) w) 0 1))))))
(defn audio-asset-content [origin size forward]
  (ui/render origin size
    (ui/column (map :padding 12 :gap 8)
      [(ui/custom (map :grow 1) audio-asset-wave)
       (ui/muted (str (/ (round (* (asset-time) 100)) 100) " / "
                      (/ (round (* (asset-duration) 100)) 100) " seconds"))
       (ui/row (map :gap 8)
         [(ui/button :asset-play (if (asset-playing?) "Pause" "Play")
            (fn [] (if (asset-playing?) (pause-asset) (play-asset))))
          (ui/button :asset-stop "Stop" (fn [] (stop-asset)))])
       (if forward (ui/button :hook-forward "+1 sec"
         (fn [] (seek-asset (min (asset-duration) (+ (asset-time) 1))))) nil)])))

(defn preview-input-active? []
  (or (not (= (get :window) "")) (generator-text-editing?)
      (and (get :show-preview) (not (get :preview-collapsed))
           (= (get :preview-kind) "text-asset"))))
(defn preview-pane-content [origin size]
  (let [kind (get :preview-kind)]
    (if (contains? ["hook-draw" "hook-sound" "hooks"] kind)
      (hook-pane-content origin size)
      (if (= kind "text-asset")
        (ui/render origin size (ui/column (map :padding 12)
          [(if (or (= (get :input-tab) "") (= (get :input-tab) "__textResource"))
             (ui/with (map :grow 1) (ui/code :__textResource)) (ui/muted "Tool input active"))]))
        (if (asset-ready?)
          (if (= kind "image-asset") (image-asset-content origin size) (audio-asset-content origin size false))
          (ui/render origin size (ui/column (map :padding 12) [(ui/muted (asset-status))])))))))
