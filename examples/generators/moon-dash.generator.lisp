; Paste the output vector into Moon Dash's :dash-level declaration.
; The course lasts 40 beats; beats 0-3 and 37-40 stay clear.
(generator :text "Moon Dash obstacle chart" "levels/moon-dash-chart.lisp")
(init! :chart-seed 13 ["Seed" 1 999999 1])
(init! :chart-spacing 3 ["Spacing / beats" 2 6 1])
(init! :chart-density 80 ["Obstacle chance / %" 25 100 1])
(init! :chart-difficulty "spooky" ["Difficulty" ["gentle" "spooky" "spicy"]])

; Integer pseudo-random samples: no global RNG or state mutation.
; Separate salts keep obstacle choice independent of placement probability.
(defn chart-roll [slot salt]
  (let [a (mod (+ (* (get :chart-seed) 16807) (* slot 104729) (* salt 7919)) 2147483647)
        b (mod (* a 48271) 2147483647)
        c (mod (* b 48271) 2147483647)]
    (mod c 100)))

(defn chart-kinds []
  (cond
    (= (get :chart-difficulty) "gentle") ["spike" "block"]
    (= (get :chart-difficulty) "spicy") ["spike" "block" "gap" "double"]
    true ["spike" "block" "gap"]))

(defn generate-text []
  (let [spacing (get :chart-spacing) kinds (chart-kinds)
        slots (range (+ 1 (floor (/ 32 spacing))))
        occupied (filter (fn [slot]
          (or (= slot 0) (< (chart-roll slot 1) (get :chart-density)))) slots)
        rows (mapv (fn [slot]
          (let [beat (+ 4 (* slot spacing))
                kind (nth kinds (mod (chart-roll slot 2) (count kinds)))]
            (str "  [" beat " \"" kind "\"]"))) occupied)]
    (str "[\n" (join rows "\n") "\n]\n")))
