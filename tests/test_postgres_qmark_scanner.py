from backend.db.db_helper import _convert_qmark_parameters


def test_qmark_scanner_preserves_literals_identifiers_comments_dollar_quotes_and_jsonb_operators():
    statement = """
        SELECT data ? 'key', data ?| ARRAY['a'], data ?& ARRAY['b'],
               $tag$ body ? untouched $tag$, 'literal ? escaped'' ? ',
               \"quoted ? identifier\"
        -- comment ?
        /* block ? */
        WHERE id = ? AND note = ?
    """
    converted = _convert_qmark_parameters(statement)
    assert "data ? 'key'" in converted
    assert "data ?| ARRAY" in converted
    assert "data ?& ARRAY" in converted
    assert "$tag$ body ? untouched $tag$" in converted
    assert "'literal ? escaped'' ? '" in converted
    assert '"quoted ? identifier"' in converted
    assert "WHERE id = %s AND note = %s" in converted


def test_qmark_scanner_preserves_postgres_escape_string_question_marks():
    statement = r"SELECT E'it\'s ? intact', id FROM records WHERE id = ?"
    converted = _convert_qmark_parameters(statement)
    assert r"E'it\'s ? intact'" in converted
    assert "WHERE id = %s" in converted


def test_qmark_scanner_preserves_question_marks_in_nested_block_comments():
    statement = "SELECT 1 /* outer /* inner */ still ? outer */ WHERE id = ?"
    converted = _convert_qmark_parameters(statement)
    assert "still ? outer" in converted
    assert "WHERE id = %s" in converted
