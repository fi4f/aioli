; ui/code-input.lisp / live Lisp drawing and interaction.
(defn token-color [kind]
  (if (= kind "comment") "#65776a"
    (if (= kind "string") "#c2c59d"
      (if (= kind "keyword") "#a7c5af"
        (if (= kind "number") "#b9b09c"
          (if (= kind "delimiter") "#849689" (get :ui-text)))))))

; The host supplies buffer/input data. Lisp paints the source widget.

(defn code-editor [origin size tab]
  (buffer-open origin size tab)
  (scope
    (clip origin size)
    (let [selections (buffer-selections) rows (buffer-rows)]
      (fill "#344339")
      (repeat (count selections) i
        (let [selection (nth selections i)]
          (rect (nth selection 0) (nth selection 1))))
      (repeat (count rows) i
        (let [row (nth rows i) segments (nth row 2)]
          (fill "#526258") (text (nth row 0) (nth row 1))
          (repeat (count segments) j
            (let [token (nth segments j)]
              (fill (token-color (nth token 2)))
              (text (nth token 0) (nth token 1)))))))
    (when (buffer-caret)
      (fill (get :ui-accent))
      (rect (buffer-caret) [1 18]))))
