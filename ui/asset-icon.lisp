; ui/asset-icon.lisp / live Lisp drawing and interaction.
(defn ordinary-asset-icon [kind x y]
  (scope
    (fill (get :ui-muted))
    (if (= kind "folder")
      (do (rect [x (+ y 3)] [14 10]) (rect [x y] [6 4]))
      (if (= kind "audio")
        (do (line [(+ x 5) (+ y 2)] [(+ x 5) (+ y 11)] 1)
            (line [(+ x 5) (+ y 2)] [(+ x 12) y] 2)
            (line [(+ x 12) y] [(+ x 12) (+ y 9)] 1)
            (circle [(+ x 3) (+ y 11)] 2) (circle [(+ x 10) (+ y 9)] 2))
        (do
          (line [x y] [(+ x 13) y] 1) (line [x y] [x (+ y 14)] 1)
          (line [(+ x 13) y] [(+ x 13) (+ y 14)] 1)
          (line [x (+ y 14)] [(+ x 13) (+ y 14)] 1)
          (if (= kind "image")
            (do (circle [(+ x 9) (+ y 4)] 2)
                (line [(+ x 2) (+ y 11)] [(+ x 5) (+ y 7)] 1)
                (line [(+ x 5) (+ y 7)] [(+ x 11) (+ y 12)] 1))
            (if (= kind "code")
              (do (line [(+ x 5) (+ y 4)] [(+ x 2) (+ y 7)] 1)
                  (line [(+ x 2) (+ y 7)] [(+ x 5) (+ y 10)] 1)
                  (line [(+ x 8) (+ y 4)] [(+ x 11) (+ y 7)] 1)
                  (line [(+ x 11) (+ y 7)] [(+ x 8) (+ y 10)] 1))
              (do (rect [(+ x 3) (+ y 4)] [7 1]) (rect [(+ x 3) (+ y 8)] [7 1])))))))))

; Entry points get accent-colored application/editor badges; scenes get a frame.
(defn asset-icon [kind x y]
  (if (or (= kind "main-entry") (= kind "editor-entry") (= kind "scene"))
    (scope
      (fill (get :ui-accent))
      (if (= kind "main-entry")
        (do (line [(+ x 2) (+ y 2)] [(+ x 2) (+ y 12)] 2)
            (line [(+ x 2) (+ y 2)] [(+ x 12) (+ y 7)] 2)
            (line [(+ x 12) (+ y 7)] [(+ x 2) (+ y 12)] 2))
        (do (line [x y] [(+ x 13) y] 1) (line [x y] [x (+ y 13)] 1)
            (line [(+ x 13) y] [(+ x 13) (+ y 13)] 1)
            (line [x (+ y 13)] [(+ x 13) (+ y 13)] 1)
            (if (= kind "editor-entry")
              (do (rect [(+ x 2) (+ y 3)] [9 2]) (rect [(+ x 2) (+ y 7)] [3 4]))
              (do (line [(+ x 3) (+ y 4)] [(+ x 10) (+ y 7)] 1)
                  (line [(+ x 10) (+ y 7)] [(+ x 3) (+ y 10)] 1))))))
    (ordinary-asset-icon kind x y)))
