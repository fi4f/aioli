(init! :radius 32 ["Radius" 1 120 1])
(defdraw render []
  (background "#101613")
  (fill "#bbd6a6")
  (circle [160 120] (get :radius)))
