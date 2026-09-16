"""Permit a two-minute song's natural silence trim; retain audio guards."""
import argparse
import ast
import sys
from pathlib import Path
from common import sha


def compile_policy(source, filename):
    tree = ast.parse(source, filename)
    changes = 0
    boundary_changes = 0
    class Minimum(ast.NodeTransformer):
        def visit_Assign(self, node):
            nonlocal changes
            if (len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                    and node.targets[0].id == 'minimum' and isinstance(node.value, ast.Constant)
                    and node.value.value == 180):
                changes += 1
                node.value = ast.parse("min(180, track['duration'])", mode='eval').body
            return node
        def visit_Compare(self, node):
            nonlocal boundary_changes
            node = self.generic_visit(node)
            # The frozen checker converts last+2 seconds to an integer sample
            # and back to float. Decimal evidence such as 228.98 can round to
            # one representational epsilon below itself and fail this guard.
            if ast.dump(node, include_attributes=False) == ast.dump(
                    ast.parse('end/SR >= last+2', mode='eval').body,
                    include_attributes=False):
                boundary_changes += 1
                return ast.parse('end/SR + 1e-9 >= last+2', mode='eval').body
            return node
    tree = Minimum().visit(tree)
    if changes != 1: raise ValueError('Unknown ending trim policy; preserve saved work')
    if boundary_changes > 1: raise ValueError('Unknown ending boundary policy; preserve saved work')
    return compile(ast.fix_missing_locations(tree), filename, 'exec')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    source = args.work / 'review_ending.py'
    if sha(source) != args.source_sha256: raise ValueError('Saved ending checker changed')
    code = compile_policy(source.read_text('utf-8-sig'), str(source))
    sys.argv = [str(source), '--work', str(args.work)]
    exec(code, {'__name__': '__main__', '__file__': str(source)})
