; Normalize browser events in the host; shortcut meanings belong to the editor.
(defn editor-key-result [action state] (map :action action :state state))
(defn editor-shortcut [workspace event focus dragging]
  (let [key (lookup event :key) lower (lower-case key) command (lookup event :command false)
        shift (lookup event :shift false) alt (lookup event :alt false)
        menus ["file" "project" "view" "edit" "about"] menu (lookup workspace :menu false)
        context (lookup workspace :file-context false)]
    (cond
      (and (= key "Escape") dragging)
        (editor-key-result "cancel-drag" (map))
      (or (= key "F4") (and (= key "Escape") (lookup workspace :preview-focused false) (not menu)))
        (editor-key-result "preview" (map))
      (and command (contains? ["s" "o"] lower))
        (editor-key-result (if (= lower "o") "import" "export") (map :menu false))
      (and alt (contains? ["f" "p" "v" "e" "a"] lower))
        (editor-key-result "focus" (map :file-context false :context-kind ""
          :menu (nth menus (index-of ["f" "p" "v" "e" "a"] lower))))
      (or (= key "ContextMenu") (and shift (= key "F10")))
        (editor-key-result "context" (map))
      (and (or (string? menu) context) (= key "Escape"))
        (editor-key-result "focus" (map :menu false :file-context false))
      (and (string? menu) (not context) (contains? ["ArrowLeft" "ArrowRight"] key))
        (editor-key-result "handled" (map :menu
          (nth menus (mod (+ (index-of menus menu) (if (= key "ArrowRight") 1 4)) 5))))
      (and (or (string? menu) context) (contains? ["ArrowDown" "ArrowUp"] key))
        (editor-key-result (if (= key "ArrowDown") "menu-next" "menu-previous") (map))
      (and command shift (= lower "p"))
        (let [window (if (= (lookup workspace :window "") "palette") "" "palette")]
          (editor-key-result "palette" (merge (map :window window)
            (if (= window "palette") (map :preview-focused false) (map)))))
      (and command (= key "Enter"))
        (editor-key-result (if (= (lookup workspace :window "") "palette") "instruction" "evaluate") (map))
      (= key "Escape")
        (editor-key-result "clear-keys" (map :file-path-editing false :window "" :menu false :show-tools false))
      (and (= focus "world") (not command) (not alt) (or (= (count key) 1) (starts-with? key "Arrow")))
        (merge (editor-key-result "world-key" (map)) (map :key (if (= (count key) 1) lower key)))
      true nil)))
(defn editor-menu-focus-index [index count direction]
  (if (= count 0) -1 (if (< index 0) (if (> direction 0) 0 (- count 1)) (mod (+ index direction) count))))
