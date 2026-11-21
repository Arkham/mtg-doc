module Format exposing (money, toFixed)

{-| Numbers written the way the server's JavaScript and the old UI wrote them.
-}


{-| `$12.30`, or a dash when there's no price.
-}
money : Maybe Float -> String
money n =
    case n of
        Just v ->
            "$" ++ toFixed 2 v

        Nothing ->
            "–"


{-| JavaScript's `Number.prototype.toFixed`: the decimal nearest the exact value of the float, ties
away from zero.
-}
toFixed : Int -> Float -> String
toFixed digits x =
    if isNaN x then
        "NaN"

    else if abs x >= 1.0e21 || isInfinite x then
        String.fromFloat x

    else
        let
            magnitude =
                abs x

            ( mantissa, exponent ) =
                decimal (String.fromFloat magnitude)

            scaled =
                rounded digits magnitude mantissa exponent

            padded =
                String.padLeft (digits + 1) '0' scaled

            whole =
                String.dropRight digits padded

            -- (-0.001).toFixed(2) is "-0.00"; -0 isn't below zero, so it has no sign.
            sign =
                if x < 0 then
                    "-"

                else
                    ""
        in
        sign
            ++ whole
            ++ (if digits > 0 then
                    let
                        fraction =
                            String.right digits padded
                    in
                    "." ++ fraction

                else
                    ""
               )


{-| The shortest decimal for a float as integer digits and a power of ten: "1.25" → ("125", -2).
-}
decimal : String -> ( String, Int )
decimal text =
    let
        ( significand, power ) =
            case String.split "e" text of
                [ s, p ] ->
                    ( s, Maybe.withDefault 0 (String.toInt (String.replace "+" "" p)) )

                _ ->
                    ( text, 0 )
    in
    case String.split "." significand of
        [ i, f ] ->
            ( stripLeadingZeros (i ++ f), power - String.length f )

        _ ->
            ( stripLeadingZeros significand, power )


stripLeadingZeros : String -> String
stripLeadingZeros s =
    let
        stripped =
            String.foldl
                (\c acc ->
                    if acc == "" && c == '0' then
                        ""

                    else
                        acc ++ String.fromChar c
                )
                ""
                s
    in
    if stripped == "" then
        "0"

    else
        stripped


{-| round(value × 10^digits) as a digit string, for value = mantissa × 10^exponent.
-}
rounded : Int -> Float -> String -> Int -> String
rounded digits magnitude mantissa exponent =
    let
        shift =
            exponent + digits
    in
    if shift >= 0 then
        stripLeadingZeros (mantissa ++ String.repeat shift "0")

    else
        let
            keep =
                String.length mantissa + shift

            ( kept, rest ) =
                if keep <= 0 then
                    ( "0", String.repeat -keep "0" ++ mantissa )

                else
                    ( String.left keep mantissa, String.dropLeft keep mantissa )

            first =
                String.left 1 rest

            up =
                if first > "5" then
                    True

                else if first < "5" then
                    False

                else
                    let
                        tail =
                            String.dropLeft 1 rest
                    in
                    if String.any (\c -> c /= '0') tail then
                        True

                    else
                        -- The shortest decimal sits exactly on the midpoint; the float itself may not.
                        atLeastMidpoint magnitude kept digits
        in
        if up then
            increment kept

        else
            stripLeadingZeros kept


{-| Whether the float is at least (kept + 0.5) / 10^digits, compared exactly.
-}
atLeastMidpoint : Float -> String -> Int -> Bool
atLeastMidpoint x kept digits =
    let
        midpoint =
            toFloat (Maybe.withDefault 0 (String.toInt kept)) * 10 + 5

        scale =
            10 ^ toFloat (digits + 1)

        ( product, error ) =
            twoProduct x scale
    in
    if product /= midpoint then
        product > midpoint

    else
        error >= 0


{-| a × b as an unevaluated sum p + e, exactly (Dekker).
-}
twoProduct : Float -> Float -> ( Float, Float )
twoProduct a b =
    let
        p =
            a * b

        ( ah, al ) =
            split a

        ( bh, bl ) =
            split b
    in
    ( p, ((ah * bh - p) + ah * bl + al * bh) + al * bl )


split : Float -> ( Float, Float )
split a =
    let
        c =
            134217729 * a

        hi =
            c - (c - a)
    in
    ( hi, a - hi )


increment : String -> String
increment digits =
    let
        step c ( acc, carry ) =
            if not carry then
                ( String.cons c acc, False )

            else if c == '9' then
                ( String.cons '0' acc, True )

            else
                ( String.cons (Char.fromCode (Char.toCode c + 1)) acc, False )

        ( result, overflow ) =
            String.foldr step ( "", True ) digits
    in
    stripLeadingZeros
        (if overflow then
            "1" ++ result

         else
            result
        )
