using System.Text;
using ViaMochi.Alex.Parsing;
using ViaMochi.Alex.Syntax;

namespace Conformance;

/// <summary>
/// The canonical dump of a file parsed by the C# Alex: its tree (every node, every token with its span, flags and
/// trivia), its diagnostics, and whether it writes back out unchanged. The engine prints exactly the same format
/// (<c>cardengine/engine/src/alex/dump.rs</c>), so the two parsers are compared byte for byte.
/// </summary>
/// <remarks>Diagnostics are listed ordered by start, then length, then message (as UTF-8 bytes), so the order never
/// depends on how either side sorts.</remarks>
internal sealed class CSharpDump
{
    private readonly StringBuilder _out = new();
    private int _depth;

    public static string Dump(byte[] source, AlexParseOptions options)
    {
        SyntaxTree tree = AlexParser.Parse(source, options);
        CSharpDump dump = new();
        dump.Document(tree.Root);

        List<SyntaxDiagnostic> diagnostics = new(tree.Diagnostics);
        diagnostics.Sort(CompareDiagnostics);
        dump._out.Append("diagnostics\n");
        for (int i = 0; i < diagnostics.Count; i++)
        {
            SyntaxDiagnostic diagnostic = diagnostics[i];
            dump._out.Append("  ").Append(diagnostic.Span.Start).Append('+').Append(diagnostic.Span.Length).Append(' ')
                .Append(diagnostic.Message).Append('\n');
        }

        byte[] written = tree.ToBytes();
        dump._out.Append(written.AsSpan().SequenceEqual(source) ? "round-trip exact\n" : "round-trip different\n");
        return dump._out.ToString();
    }

    private static int CompareDiagnostics(SyntaxDiagnostic left, SyntaxDiagnostic right)
    {
        int byStart = left.Span.Start.CompareTo(right.Span.Start);
        if (byStart != 0) { return byStart; }
        int byLength = left.Span.Length.CompareTo(right.Span.Length);
        if (byLength != 0) { return byLength; }
        return Encoding.UTF8.GetBytes(left.Message).AsSpan().SequenceCompareTo(Encoding.UTF8.GetBytes(right.Message));
    }

    // ── lines ───────────────────────────────────────────────────────────────────────────────────────

    private void Node(string name)
    {
        Indent();
        _out.Append(name).Append('\n');
        _depth++;
    }

    private void End() => _depth--;

    private void Indent()
    {
        for (int i = 0; i < _depth; i++) { _out.Append("  "); }
    }

    private void Token(SyntaxToken token)
    {
        Indent();
        _out.Append(token.Kind.ToString()).Append(' ').Append(token.Span.Start).Append('+').Append(token.Span.Length);
        if (token.IsMissing) { _out.Append(" missing"); }
        if (token.StartsLine) { _out.Append(" line"); }
        Trivia(" lead", token.LeadingTrivia);
        Trivia(" trail", token.TrailingTrivia);
        _out.Append('\n');
    }

    private void Trivia(string label, IReadOnlyList<SyntaxTrivia> trivia)
    {
        if (trivia.Count == 0) { return; }
        _out.Append(label).Append('[');
        for (int i = 0; i < trivia.Count; i++)
        {
            if (i > 0) { _out.Append(','); }
            _out.Append(trivia[i].Kind.ToString()).Append(' ').Append(trivia[i].Span.Start).Append('+').Append(trivia[i].Span.Length);
        }

        _out.Append(']');
    }

    private void Optional(SyntaxToken? token)
    {
        if (token is not null) { Token(token); }
    }

    private void NamedToken(string name, SyntaxToken token)
    {
        Node(name);
        Token(token);
        End();
    }

    /// <summary>Items and separators as written; an item is dumped by <paramref name="item"/>.</summary>
    private void Separated<T>(SeparatedSyntaxList<T> list, Action<T> item) where T : SyntaxNode
    {
        for (int i = 0; i < list.Elements.Count; i++)
        {
            if (list.Elements[i] is SyntaxToken separator) { Token(separator); }
            else { item((T)list.Elements[i]); }
        }
    }

    // ── statements ──────────────────────────────────────────────────────────────────────────────────

    private void Document(DocumentSyntax document)
    {
        Node("Document");
        for (int i = 0; i < document.Statements.Count; i++) { Statement(document.Statements[i]); }
        Token(document.EndOfFile);
        End();
    }

    private void Statement(StatementSyntax statement)
    {
        switch (statement)
        {
            case DirectiveSyntax directive:
                Node("Directive");
                Token(directive.Directive);
                for (int i = 0; i < directive.Arguments.Count; i++) { Token(directive.Arguments[i]); }
                break;

            case AssignmentSyntax assignment:
                Node("Assignment");
                Path(assignment.Target);
                Token(assignment.EqualsToken);
                Value(assignment.Value);
                break;

            case TypeDeclarationSyntax type:
                Node("TypeDeclaration");
                Token(type.Keyword);
                Token(type.Name);
                Optional(type.Colon);
                Optional(type.BaseName);
                if (type.Fields is not null) { FieldList(type.Fields); }
                Optional(type.EqualsToken);
                if (type.Alias is not null) { Type(type.Alias); }
                break;

            case EnumDeclarationSyntax enumeration:
                Node("EnumDeclaration");
                Token(enumeration.Keyword);
                Token(enumeration.Name);
                Optional(enumeration.Colon);
                if (enumeration.Backing is { } backing)
                {
                    Node("EnumBacking");
                    Token(backing.Type);
                    Optional(backing.OpenParen);
                    Optional(backing.Size);
                    Optional(backing.CloseParen);
                    End();
                }

                Token(enumeration.OpenBrace);
                Separated(enumeration.Members, member =>
                {
                    Node("EnumMemberDeclaration");
                    Token(member.Name);
                    Optional(member.EqualsToken);
                    if (member.Value is not null) { Value(member.Value); }
                    End();
                });
                Token(enumeration.CloseBrace);
                break;

            case TextTableSyntax table:
                Node("TextTable");
                Token(table.Token);
                break;

            case DeclarationSyntax declaration:
                Node("Declaration");
                Token(declaration.Kind);
                Token(declaration.Name);
                if (declaration.Parameters is { } parameters)
                {
                    Node("ParameterList");
                    Token(parameters.OpenParenthesis);
                    Separated(parameters.Parameters, parameter =>
                    {
                        Node("Parameter");
                        Token(parameter.Name);
                        Token(parameter.Colon);
                        Type(parameter.Type);
                        End();
                    });
                    Token(parameters.CloseParenthesis);
                    End();
                }

                Optional(declaration.Colon);
                if (declaration.Result is not null) { Type(declaration.Result); }
                Body(declaration.Body);
                break;

            case ExtensionDeclarationSyntax extension:
                Node("ExtensionDeclaration");
                Token(extension.Keyword);
                Token(extension.TypeName);
                FieldList(extension.Members);
                break;

            case ReferenceAssignmentSyntax reference:
                Node("ReferenceAssignment");
                Token(reference.At);
                Path(reference.Target);
                Token(reference.EqualsToken);
                Value(reference.Value);
                break;

            default:
                throw new InvalidOperationException("The dump does not know the statement " + statement.GetType().Name + ".");
        }

        End();
    }

    private void FieldList(FieldListSyntax list)
    {
        Node("FieldList");
        Token(list.OpenBrace);
        Separated(list.Fields, item =>
        {
            switch (item)
            {
                case FieldDeclarationSyntax declaration:
                    Node("FieldDeclaration");
                    Token(declaration.Name);
                    Token(declaration.Colon);
                    Type(declaration.Type);
                    Optional(declaration.EqualsToken);
                    if (declaration.Default is not null) { Value(declaration.Default); }
                    End();
                    break;

                case FixedFieldSyntax fixedField:
                    Node("FixedField");
                    Token(fixedField.Name);
                    Token(fixedField.EqualsToken);
                    Value(fixedField.Value);
                    End();
                    break;

                default:
                    throw new InvalidOperationException("The dump does not know the field item " + item.GetType().Name + ".");
            }
        });
        Token(list.CloseBrace);
        End();
    }

    private void Path(PathSyntax path)
    {
        Node("Path");
        Separated(path.Segments, segment => NamedToken("Name", segment.Identifier));
        End();
    }

    // ── values ──────────────────────────────────────────────────────────────────────────────────────

    private void Value(ValueSyntax value)
    {
        switch (value)
        {
            case LiteralSyntax literal:
                Node("Literal " + literal.Kind.ToString());
                Token(literal.Token);
                break;

            case EnumMemberSyntax member:
                Node("EnumMember");
                Optional(member.EnumName);
                Optional(member.Dot);
                Token(member.Member);
                break;

            case RecordSyntax record:
                Node("Record");
                Token(record.TypeName);
                Token(record.OpenBrace);
                Separated(record.Fields, field =>
                {
                    Node("FieldValue");
                    Token(field.Name);
                    Token(field.EqualsToken);
                    Value(field.Value);
                    End();
                });
                Token(record.CloseBrace);
                break;

            case OpenInstanceSyntax open:
                Node("OpenInstance");
                Token(open.TypeName);
                break;

            case ListSyntax list:
                Node("List");
                Token(list.OpenBracket);
                Separated(list.Items, Value);
                Token(list.CloseBracket);
                break;

            case MapSyntax map:
                Node("Map");
                Token(map.OpenBracket);
                Separated(map.Entries, entry =>
                {
                    Node("MapEntry");
                    Token(entry.Key);
                    Token(entry.EqualsToken);
                    Value(entry.Value);
                    End();
                });
                Token(map.CloseBracket);
                break;

            case ReferenceSyntax reference:
                Node("Reference");
                Token(reference.At);
                Path(reference.Path);
                break;

            case NameofSyntax nameof:
                Node("Nameof");
                Token(nameof.Keyword);
                Token(nameof.OpenParen);
                Path(nameof.Path);
                Token(nameof.CloseParen);
                break;

            case MissingValueSyntax missing:
                Node("MissingValue");
                Token(missing.Missing);
                break;

            case InlineStatementSyntax inline:
                Node("InlineStatement");
                BodyStatement(inline.Statement);
                break;

            default:
                throw new InvalidOperationException("The dump does not know the value " + value.GetType().Name + ".");
        }

        End();
    }

    // ── types ───────────────────────────────────────────────────────────────────────────────────────

    private void Type(TypeSyntax type)
    {
        switch (type)
        {
            case NamedTypeSyntax named:
                Node("NamedType");
                Token(named.Name);
                break;

            case TypeOfTypeSyntax typeOfType:
                Node("TypeOfType");
                Token(typeOfType.TypeKeyword);
                NamedToken("NamedType", typeOfType.Record.Name);
                break;

            case OptionalTypeSyntax optional:
                Node("OptionalType");
                Type(optional.Type);
                Token(optional.Question);
                break;

            case UnionTypeSyntax union:
                Node("UnionType");
                Separated(union.Alternatives, Type);
                break;

            case ListTypeSyntax list:
                Node("ListType");
                Token(list.OpenBracket);
                Type(list.Element);
                Token(list.CloseBracket);
                break;

            case MapTypeSyntax map:
                Node("MapType");
                Token(map.OpenBracket);
                Type(map.Key);
                Token(map.Colon);
                Type(map.Value);
                Token(map.CloseBracket);
                break;

            case TupleTypeSyntax tuple:
                Node("TupleType");
                Token(tuple.OpenBracket);
                Separated(tuple.Items, Type);
                Token(tuple.CloseBracket);
                break;

            case MissingTypeSyntax missing:
                Node("MissingType");
                Token(missing.Missing);
                break;

            default:
                throw new InvalidOperationException("The dump does not know the type " + type.GetType().Name + ".");
        }

        End();
    }

    // ── the program layer ───────────────────────────────────────────────────────────────────────────

    private void Body(BodySyntax body)
    {
        switch (body)
        {
            case BlockSyntax block:
                Block(block);
                break;

            case ExpressionBodySyntax expressionBody:
                Node("ExpressionBody");
                Token(expressionBody.EqualsToken);
                Expression(expressionBody.Expression);
                End();
                break;

            default:
                throw new InvalidOperationException("The dump does not know the body " + body.GetType().Name + ".");
        }
    }

    private void Block(BlockSyntax block)
    {
        Node("Block");
        Token(block.OpenBrace);
        for (int i = 0; i < block.Statements.Count; i++) { BodyStatement(block.Statements[i]); }
        Token(block.CloseBrace);
        End();
    }

    private void BodyStatement(BodyStatementSyntax statement)
    {
        switch (statement)
        {
            case BindingSyntax binding:
                Node("Binding");
                Token(binding.Name);
                Token(binding.EqualsToken);
                Expression(binding.Value);
                break;

            case ExpressionStatementSyntax expression:
                Node("ExpressionStatement");
                Expression(expression.Expression);
                break;

            case CompoundCallSyntax compound:
                Node("CompoundCall");
                Expression(compound.Call);
                Token(compound.Operator);
                Expression(compound.Delta);
                break;

            case IfStatementSyntax ifStatement:
                Node("IfStatement");
                Token(ifStatement.IfKeyword);
                Expression(ifStatement.Condition);
                Block(ifStatement.Then);
                Optional(ifStatement.ElseKeyword);
                if (ifStatement.Else is not null) { Block(ifStatement.Else); }
                break;

            case SectionSyntax section:
                Node("Section");
                Token(section.Label);
                Separated(section.Items, Expression);
                break;

            default:
                throw new InvalidOperationException("The dump does not know the body statement " + statement.GetType().Name + ".");
        }

        End();
    }

    private void Expression(ExpressionSyntax expression)
    {
        switch (expression)
        {
            case LiteralExpressionSyntax literal:
                Node("LiteralExpression " + literal.Kind.ToString());
                Token(literal.Token);
                break;

            case NameExpressionSyntax name:
                Node("NameExpression");
                Token(name.Identifier);
                break;

            case ReferenceExpressionSyntax reference:
                Node("ReferenceExpression");
                Token(reference.At);
                Path(reference.Path);
                break;

            case MemberAccessSyntax member:
                Node("MemberAccess");
                Expression(member.Receiver);
                Token(member.Dot);
                Token(member.Name);
                break;

            case CallSyntax call:
                Node("Call");
                Expression(call.Callee);
                Token(call.OpenParen);
                Separated(call.Arguments, argument =>
                {
                    Node("Argument");
                    Optional(argument.Name);
                    Optional(argument.Colon);
                    Expression(argument.Value);
                    End();
                });
                Token(call.CloseParen);
                break;

            case UnaryExpressionSyntax unary:
                Node("UnaryExpression");
                Token(unary.Operator);
                Expression(unary.Operand);
                break;

            case SignedExpressionSyntax signed:
                Node("SignedExpression");
                Token(signed.Sign);
                Expression(signed.Operand);
                break;

            case BinaryExpressionSyntax binary:
                Node("BinaryExpression");
                Expression(binary.Left);
                Token(binary.Operator);
                Expression(binary.Right);
                break;

            case ParenthesizedExpressionSyntax parenthesized:
                Node("ParenthesizedExpression");
                Token(parenthesized.OpenParen);
                Expression(parenthesized.Inner);
                Token(parenthesized.CloseParen);
                break;

            case MissingExpressionSyntax missing:
                Node("MissingExpression");
                Token(missing.Missing);
                break;

            default:
                throw new InvalidOperationException("The dump does not know the expression " + expression.GetType().Name + ".");
        }

        End();
    }
}
