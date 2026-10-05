(generator :text "New text" "generated.txt")
(init! :text-message "Hello world" ["Message"])
(defn generate-text [] (str (get :text-message) "\n"))
