class VersionComparisonError(ValueError):
    def __init__(self, code, message, *, status_code=400, fields=None):
        super().__init__(message)
        self.code = str(code)
        self.message = str(message)
        self.status_code = int(status_code)
        self.fields = fields if isinstance(fields, dict) else {}
