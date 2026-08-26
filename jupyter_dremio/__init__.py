from ._version import __version__


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyter-dremio"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyter_dremio"}]


def _load_jupyter_server_extension(server_app):
    from .handlers import setup_handlers
    setup_handlers(server_app.web_app)
    server_app.log.info("jupyter_dremio server extension loaded")
