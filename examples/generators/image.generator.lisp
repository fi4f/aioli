(generator :image "Shapes")
; Drawables compose shapes and nested GPU pixels in painter order.
(init! :image-radius 48 ["Radius" 1 120 1])
(init! :image-x 160 ["X" 0 320 1])
(init! :image-y 120 ["Y" 0 240 1])
(init! :image-color "#bbd6a6" ["Color"])
(init! :image-shape 0 ["Shape" [0 1 2]])
(defdraw render []
  (pixels [p time]
  (background "#101613")
  (fill (get :image-color))
  ; Shape masks let GUI choices compose with ordinary pixel drawing.
  (scope
    (opacity (- 1 (step 0.5 (get :image-shape))))
    (circle [(get :image-x) (get :image-y)] (get :image-radius)))
  (scope
    (opacity (* (step 0.5 (get :image-shape))
                (- 1 (step 1.5 (get :image-shape)))))
    (rect [(- (get :image-x) (get :image-radius))
           (- (get :image-y) (get :image-radius))]
          [(* 2 (get :image-radius)) (* 2 (get :image-radius))]))
  (scope
    (opacity (step 1.5 (get :image-shape)))
    (line [(- (get :image-x) (get :image-radius)) (get :image-y)]
          [(+ (get :image-x) (get :image-radius)) (get :image-y)] 4))))
