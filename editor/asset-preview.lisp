; Resource previews are pixel UI windows. The host only decodes image/audio data.
(defn image-asset-view [x y w h]
  (let [vw (- w 32) vh (- h 108) ox (+ x 16) oy (+ y 44)
        fit (min 1 (/ vw (max 1 (asset-width))) (/ vh (max 1 (asset-height))))]
    (scope
      (clip [ox oy] [vw vh])
      ; Checkerboard makes transparent pixels visible without changing the asset.
      (repeat 12 i (repeat 8 j
        (fill (if (= (mod (+ i j) 2) 0) "#202823" "#29332c"))
        (rect [(+ ox (* i (/ vw 12))) (+ oy (* j (/ vh 8)))] [(/ vw 12) (/ vh 8)])))
      (region :asset-image-area "Image / drag to pan, wheel to zoom" [ox oy] [vw vh])
      (when (and (pointer-pressed?) (hit? [ox oy] [vw vh]))
        (capture! :asset-image-area)
        (set! :preview-drag-x (pointer-x)) (set! :preview-drag-y (pointer-y))
        (set! :preview-drag-pan-x (get :preview-pan-x)) (set! :preview-drag-pan-y (get :preview-pan-y)))
      (when (and (pointer-down?) (captured? :asset-image-area))
        (set! :preview-pan-x (+ (get :preview-drag-pan-x) (- (pointer-x) (get :preview-drag-x))))
        (set! :preview-pan-y (+ (get :preview-drag-pan-y) (- (pointer-y) (get :preview-drag-y)))))
      (let [iw (* (asset-width) fit (get :preview-zoom)) ih (* (asset-height) fit (get :preview-zoom))]
        (asset-image [(+ ox (/ (- vw iw) 2) (get :preview-pan-x))
                      (+ oy (/ (- vh ih) 2) (get :preview-pan-y))] [iw ih])))
    (let [by (+ y h -48)]
      (when (ui-button :asset-zoom-out "-" [(+ x 16) by] [32 32] false)
        (set! :preview-zoom (max 0.1 (/ (get :preview-zoom) 1.25))))
      (when (ui-button :asset-zoom-in "+" [(+ x 52) by] [32 32] false)
        (set! :preview-zoom (min (/ 32 fit) (* (get :preview-zoom) 1.25))))
      (when (ui-button :asset-fit "Fit" [(+ x 88) by] [56 32] false)
        (set! :preview-zoom 1) (set! :preview-pan-x 0) (set! :preview-pan-y 0))
      (when (ui-button :asset-actual-size "1:1" [(+ x 148) by] [56 32] false)
        (set! :preview-zoom (/ 1 fit)) (set! :preview-pan-x 0) (set! :preview-pan-y 0))
      (fill (get :ui-muted))
      (text [(+ x 216) (+ by 8)] (str (round (* 100 fit (get :preview-zoom))) "%")))))

(defn audio-asset-view [x y w h]
  (let [ox (+ x 16) oy (+ y 58) width (- w 32) height (max 40 (- h 164))
        duration (max 0.001 (asset-duration))]
    (fill "#101613") (rect [ox oy] [width height])
    (fill "#344339") (rect [ox (+ oy (/ height 2))] [width 1])
    (fill (get :ui-accent)) (asset-waveform [ox oy] [width height])
    (fill "#e9bca9")
    (rect [(+ ox (* width (/ (asset-time) duration))) oy] [1 height])
    (region :asset-seek "Audio / click or drag to seek" [ox oy] [width height])
    (when (and (pointer-pressed?) (hit? [ox oy] [width height])) (capture! :asset-seek))
    (when (and (or (pointer-down?) (pointer-pressed?)) (captured? :asset-seek))
      (seek-asset (* duration (clamp (/ (- (pointer-x) ox) width) 0 1))))
    (fill (get :ui-muted))
    (text [ox (+ oy height 12)] (str (/ (round (* (asset-time) 100)) 100) " / "
                                     (/ (round (* duration 100)) 100) " seconds"))
    (let [by (+ y h -48)]
      (when (ui-button :asset-play (if (asset-playing?) "Pause" "Play") [ox by] [88 32] false)
        (if (asset-playing?) (pause-asset) (play-asset)))
      (when (ui-button :asset-stop "Stop" [(+ ox 96) by] [72 32] false) (stop-asset)))))

(defn asset-preview-window []
  (let [image (= (get :window) "image-asset")
        w (min (if image 900 760) (- (screen-width) 32))
        h (min (if image 650 340) (- (screen-height) 100))
        x (/ (- (screen-width) w) 2) y 64]
    (fill "#354239") (rect [(- x 1) (- y 1)] [(+ w 2) (+ h 2)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (region :asset-window "Asset preview" [x y] [w h])
    (scope (clip [(+ x 16) (+ y 12)] [(- w 110) 24])
      (fill (get :ui-text)) (text [(+ x 16) (+ y 12)] (get :preview-path)))
    (when (ui-button :close-window "Close" [(+ x w -84) (+ y 4)] [76 32] false)
      (close-asset-preview))
    (if (asset-ready?)
      (if image (image-asset-view x y w h) (audio-asset-view x y w h))
      (scope (clip [(+ x 16) (+ y 60)] [(- w 32) (- h 80)])
        (fill (get :ui-muted)) (text [(+ x 16) (+ y 64)] (asset-status))))))
