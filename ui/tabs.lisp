; Each tab has its own selection and undo history in the shared source input.
(defn code-tab-strip [x y width]
  (let [tabs (code-tabs width)]
    (scope
      (clip [x y] [width 32])
      (repeat (count tabs) i
        (let [tab (nth tabs i) key (nth tab 0) tx (+ x (nth tab 2)) tw (nth tab 3)]
          (scope
            (clip [tx y] [(- tw 26) 32])
            (when (ui-button (str "tab-" key)
                    (str (nth tab 1) (if (nth tab 4) " *" ""))
                    [tx y] [(- tw 26) 32] (= (get :tab) key))
              (open-code-tab key)))
          (when (ui-button (str "close-tab-" key) "x" [(+ tx tw -26) y] [24 32] false)
            (close-code-tab key))))
      (when (code-tabs-before?)
        (when (ui-button :tabs-prev "<" [(+ x width -48) y] [24 32] false) (scroll-code-tabs -1)))
      (when (code-tabs-after?)
        (when (ui-button :tabs-next ">" [(+ x width -24) y] [24 32] false) (scroll-code-tabs 1))))))
