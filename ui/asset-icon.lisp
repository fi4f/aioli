; Icons are ordinary image resources, chosen and tinted by the Lisp editor.
(defn asset-icon [kind x y]
  (let [name (if (= kind "main-entry") "game"
                (if (= kind "editor-entry") "main"
                  (if (= kind "asset") "file" kind)))
        path (str "assets/editor-icons/" name ".png")
        special (or (= kind "main-entry") (= kind "editor-entry") (= kind "scene") (= kind "generator"))]
    (scope
      (fill (if special (get :ui-accent) (get :ui-muted)))
      (if (icon-available? path)
        (icon path [x y] [16 16])
        (text [(+ x 4) y] "?")))))
