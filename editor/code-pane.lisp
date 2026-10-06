; The code pane hosts the tab strip and one shared native input buffer.
(defn code-pane [x width height]
  (let [collapsed (get :code-collapsed)]
  (fill (get :ui-panel)) (rect [x 51] [width (- height 81)])
  (ui-pane-toggle :collapse-code :code-collapsed "Code editor"
                  (if collapsed x (+ x width -40)) 51 40 false)
  (if collapsed
    (asset-icon "code" (+ x 12) 99)
    (do
  (code-tab-strip (+ x 8) 58 (- width 56))
  (fill (get :ui-muted))
  (scope (clip [(+ x 16) 94] [(- width 32) 20])
    (text [(+ x 16) 94] (active-code-path)))
  (if (and (= (get :window) "") (not (generator-text-editing?)))
    (if (= (get :tab) "")
      (text [(+ x 24) 124] "Open a source file from Files")
      (code-editor [(+ x 16) 120] [(- width 32) (- height 168)] (get :tab)))
    (text [(+ x 24) 124] "Tool input active"))))))
