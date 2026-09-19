"""Extend only known planning limits, retaining pinned audio recipes."""
import ast
import inspect
import textwrap

GUARD = ast.parse('180 <= duration <= 300', mode='eval').body


def extend(function, minimum=120):
    if minimum not in (60, 120): raise ValueError('Unsupported minimum song duration')
    tree = ast.parse(textwrap.dedent(inspect.getsource(function)))
    changes = 0
    class Limits(ast.NodeTransformer):
        def visit_Compare(self, node):
            nonlocal changes
            if ast.dump(node) == ast.dump(GUARD):
                changes += 1
                return ast.copy_location(ast.parse(f'{minimum} <= duration <= 600', mode='eval').body, node)
            return self.generic_visit(node)
        def visit_Constant(self, node):
            replacements = {'New songs must be 3–5 minutes.': f'New songs must be {minimum}–600 seconds per rendering.',
                            'Full-song duration must be 180–300 seconds': f'Single-render duration must be {minimum}–600 seconds'}
            if isinstance(node.value, str) and node.value in replacements:
                return ast.copy_location(ast.Constant(value=replacements[node.value]), node)
            return node
    tree = Limits().visit(tree)
    if changes != 1: raise ValueError('Unknown duration validator; preserve saved work for review')
    namespace = dict(function.__globals__)
    exec(compile(ast.fix_missing_locations(tree), function.__code__.co_filename, 'exec'), namespace)
    return namespace[function.__name__]


def adapt(engine, minimum=120):
    engine.validate_spec = extend(engine.validate_spec, minimum)
    original = engine.engine
    def studio(settings):
        module = original(settings)
        module.plan = extend(module.plan, minimum)
        return module
    engine.engine = studio
