import importlib.machinery
import importlib.util
import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
project_root = os.path.dirname(backend_dir)
models_dir = os.path.join(project_root, 'models')

sys.path.insert(0, project_root)
sys.path.append(models_dir)


def load_and_register(name, filepath):
    loader = importlib.machinery.SourcelessFileLoader(name, filepath)
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    sys.modules[name] = module
    loader.exec_module(module)
    return module


models = load_and_register('models', os.path.join(models_dir, 'models.cpython-314.pyc'))
database = load_and_register('database', os.path.join(models_dir, 'database.cpython-314.pyc'))

orig_get_connection = database.get_connection


def optimized_get_connection(*args, **kwargs):
    raw_conn = orig_get_connection(*args, **kwargs)
    try:
        cursor = raw_conn.cursor()
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA busy_timeout = 15000")
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA cache_size = -65536")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.execute("PRAGMA temp_store = MEMORY")
    except Exception as e:
        print(f"Error applying SQLite PRAGMAs: {e}")
    return raw_conn


database.get_connection = optimized_get_connection
