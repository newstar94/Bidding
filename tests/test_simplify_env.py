from scripts.simplify_env import simplify, configuration
from dotenv import dotenv_values
from io import StringIO


def test_removes_defaults_and_retired_setting_without_changing_configuration():
    text = ('AI_PROVIDER=fake\nAI_KNOWLEDGE_ENABLED=true\n'
            'AI_DAILY_REQUEST_LIMIT=100\nPROCUREMENT_ALLOWED_TARGET_HOSTS=muasamcong.mpi.gov.vn\n'
            'WORD_EXPORT_STANDARDIZATION_MODE=apply_safe\n')
    result, removed = simplify(text)
    assert set(removed) == {'AI_KNOWLEDGE_ENABLED', 'AI_DAILY_REQUEST_LIMIT',
                            'PROCUREMENT_ALLOWED_TARGET_HOSTS', 'WORD_EXPORT_STANDARDIZATION_MODE'}
    assert configuration(dotenv_values(stream=StringIO(result))) == configuration(dotenv_values(stream=StringIO(text)))


def test_preserves_custom_limits_separate_search_credentials_and_crlf():
    text = ('AI_PROVIDER=fake\r\nAI_API_KEY=chat-test\r\n'
            'AI_WEB_SEARCH_API_KEY=search-test\r\nAI_MODEL=chat\r\n'
            'AI_WEB_SEARCH_MODEL=search\r\nAI_DAILY_REQUEST_LIMIT=321\r\n')
    assert simplify(text) == (text, [])


def test_process_fallback_prevents_removing_explicit_search_key():
    text = 'AI_PROVIDER=fake\nAI_API_KEY=same\nAI_WEB_SEARCH_API_KEY=same\n'
    result, removed = simplify(text, {'GEMINI_API_KEY': 'different'})
    assert 'AI_WEB_SEARCH_API_KEY' not in removed
    assert result == text


def test_idempotent_and_preserves_unrelated_secrets_and_comments():
    text = '# SMTP\nSMTP_PASSWORD="test-only"\n# Keep this disabled\n# AI_MODEL=other\n'
    result, removed = simplify(text)
    assert (result, removed) == (text, [])
    assert simplify(result) == (text, [])
