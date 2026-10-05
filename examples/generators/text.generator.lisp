(generator :text "Level CSV" "levels/generated.csv")
(init! :level-name "garden" ["Level name"])
(init! :level-width 320 ["Width" 64 1024 16])
(init! :level-height 240 ["Height" 64 1024 16])
(defn generate-text []
  (str "name,width,height\n" (get :level-name) "," (get :level-width) "," (get :level-height) "\n"))
