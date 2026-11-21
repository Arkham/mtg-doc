module FormatTest exposing (suite)

import Expect
import Format exposing (toFixed)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "toFixed"
        [ test "matches JavaScript, including floats just under a midpoint" <|
            \_ ->
                List.map (\( d, x ) -> toFixed d x)
                    [ ( 2, 1.005 ), ( 2, 0.125 ), ( 1, 1.5000000000000036 ), ( 2, -0.001 ), ( 0, 2.5 ), ( 0, -2.5 ), ( 2, 12.3 ), ( 1, 1.0e-7 ), ( 2, 1234.5678 ), ( 2, 0 ), ( 1, 0.05 ), ( 2, 37.965 ) ]
                    |> Expect.equal [ "1.00", "0.13", "1.5", "-0.00", "3", "-3", "12.30", "0.0", "1234.57", "0.00", "0.1", "37.97" ]
        ]
