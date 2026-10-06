; ui/code-input.lisp / live Lisp drawing and interaction.
(defn token-color [kind]
  (if (= kind "comment") (get :ui-syntax-comment)
    (if (= kind "string") (get :ui-syntax-string)
      (if (= kind "keyword") (get :ui-syntax-keyword)
        (if (= kind "number") (get :ui-syntax-number)
          (if (= kind "delimiter") (get :ui-syntax-delimiter) (get :ui-text)))))))

(defn inline-hook-button [hook]
  (let [origin (nth hook 0) size (nth hook 1) name (nth hook 2)
        id (str "inspect-hook-" name) label (str "Preview " (nth hook 3) " / " name)]
    (scope (clip origin size)
      (fill (if (or (hit? origin size) (focused? id)) (get :ui-hook-hover) (get :ui-hook-bg)))
      (rect origin size)
      (fill (get :ui-accent)) (rect origin [2 (nth size 1)])
      (text [(+ (nth origin 0) 8) (+ (nth origin 1) 1)] label))
    (region id label origin size)
    (when (or (activated? id) (and (pointer-pressed?) (hit? origin size)))
      (inspect-inline-hook name))))

; The host supplies buffer/input data. Lisp paints the source widget.

(defn code-editor [origin size tab]
  (buffer-open origin size tab)
  (scope
    (clip origin size)
    ; Resolve the palette once per frame. Calling token-color for every segment
    ; can exhaust the shared evaluation budget on a screen of dense source.
    (let [selections (buffer-selections) rows (buffer-rows)
          colors (map "comment" (token-color "comment")
                      "string" (token-color "string")
                      "keyword" (token-color "keyword")
                      "number" (token-color "number")
                      "delimiter" (token-color "delimiter")
                      "symbol" (token-color "symbol")
                      "whitespace" (token-color "whitespace"))]
      (fill (get :ui-selection))
      (repeat (count selections) i
        (let [selection (nth selections i)]
          (rect (nth selection 0) (nth selection 1))))
      (repeat (count rows) i
        (let [row (nth rows i) segments (nth row 2)]
          (fill (get :ui-line-number)) (text (nth row 0) (nth row 1))
          (mapv (fn [token]
                  (fill (lookup colors (nth token 2)))
                  (text (nth token 0) (nth token 1))) segments))))
    (let [hooks (buffer-hooks)]
      (repeat (count hooks) i (inline-hook-button (nth hooks i))))
    (when (buffer-caret)
      (fill (get :ui-accent))
      (rect (buffer-caret) [1 18]))))
