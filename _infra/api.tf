data "aws_route53_zone" "api_hosted_zone" {
  count = var.API_DOMAIN != "" && var.HOSTED_ZONE_NAME != "" ? 1 : 0
  name  = var.HOSTED_ZONE_NAME
}

resource "aws_acm_certificate" "api_cert" {
  count             = var.API_DOMAIN != "" && var.HOSTED_ZONE_NAME != "" && var.API_CERT_ARN == "" ? 1 : 0
  domain_name       = var.API_DOMAIN
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = length(aws_acm_certificate.api_cert) > 0 ? {
    for dvo in aws_acm_certificate.api_cert[0].domain_validation_options :
    dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}

  name    = each.value.name
  type    = each.value.type
  zone_id = data.aws_route53_zone.api_hosted_zone[0].zone_id
  records = [each.value.value]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "api_cert" {
  count                   = length(aws_acm_certificate.api_cert)
  certificate_arn         = aws_acm_certificate.api_cert[0].arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

resource "aws_security_group" "api_alb_sg" {
  name_prefix = "${local.name_prefix}-api-alb-"
  description = "ALB SG for ${local.name_prefix} API"
  vpc_id      = aws_vpc.app_vpc.id

  ingress {
    description = "Allow HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Allow HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow ALB egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "api_alb" {
  name               = "${local.name_prefix}-api"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.api_alb_sg.id]
  subnets            = [aws_subnet.app_public_subnet_1.id, aws_subnet.app_public_subnet_2.id]
}

resource "aws_lb_target_group" "api_tg" {
  name        = "${local.name_prefix}-api-tg"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.app_vpc.id

  health_check {
    path                = "/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "api_http" {
  load_balancer_arn = aws_lb.api_alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api_tg.arn
  }
}

resource "aws_lb_listener" "api_https" {
  count             = var.API_DOMAIN != "" && (var.API_CERT_ARN != "" || var.HOSTED_ZONE_NAME != "") ? 1 : 0
  load_balancer_arn = aws_lb.api_alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.API_CERT_ARN != "" ? var.API_CERT_ARN : aws_acm_certificate.api_cert[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api_tg.arn
  }

  depends_on = [aws_acm_certificate_validation.api_cert]
}

resource "aws_route53_record" "api_alias" {
  count = var.API_DOMAIN != "" && var.HOSTED_ZONE_NAME != "" ? 1 : 0

  zone_id = data.aws_route53_zone.api_hosted_zone[0].zone_id
  name    = var.API_DOMAIN
  type    = "A"

  alias {
    name                   = aws_lb.api_alb.dns_name
    zone_id                = aws_lb.api_alb.zone_id
    evaluate_target_health = true
  }
}

output "api_alb_dns_name" {
  value = aws_lb.api_alb.dns_name
}

output "api_domain" {
  value = var.API_DOMAIN
}
